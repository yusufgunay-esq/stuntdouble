# Architecture & Mathematical Foundations of Stuntdouble

**Competent combat hand-over for story-driven single-player games (Stuntdouble)** addresses a longstanding structural asymmetry in interactive entertainment: narrative-driven games frequently cast the player as an elite operative, mythic mercenary, or master tactician, yet rely solely on raw human motor execution during repetitive combat encounters. When an encounter becomes tedious—or when a player wishes to experience combat as a directed action sequence—naive "bot takeover" toggles (`is_human = false`) fail because standard NPC AI is designed to serve as expendable opposition rather than a competent protagonist.

Stuntdouble treats the game's own AI as the foundation and adds a competence layer on top: the native AI is written to lose, so Stuntdouble overrides only its weak moments (wind-up parry/dodge, low-health retreat, target choice, oscillation). When the native AI is unreachable, the same brain drives alone. Hand-over is automatic on combat (`engage: onCombat`) or by a user-chosen toggle key.

Stuntdouble pairs **Binary Seam Reconnaissance (via REA)** with an **Engine-Agnostic 4-Layer Cognitive Kernel (`@stuntdouble/brain`)** and a **Tri-Modal Presentation Director**.

---

## 1. Hierarchical 4-Layer Cognitive Architecture

Every Stuntdouble Brain implementation (`TypeScript`, `C#`, `C++20`, `Lua`) executes a deterministic-stochastic hybrid tick divided into four strict layers:

$$\mathcal{T}_{\text{Stuntdouble}}(t) = \mathcal{L}_1\Big(\mathcal{L}_2(S_t), \; \mathcal{L}_3\big(\mathcal{L}_2(S_t), \mathcal{L}_4(\mathcal{P})\big)\Big)$$

### Layer 4: Narrative & Tactical Orchestrator ($\mathcal{L}_4$)
Evaluates global encounter pressure, protagonist health/stamina ratios, and the loaded **Profile** $\mathcal{P} = \langle \alpha, \delta, \phi, \tau_r, r^* \rangle$ (where $\alpha \in [0,1]$ is aggression, $\delta \in [0,1]$ is discipline, $\phi \in [0,1]$ is cinematic flair, $\tau_r$ is motor latency, and $r^*$ is preferred engagement range).
- Selects the active **Tactical Stance** $\sigma \in \{\text{AGGRESSIVE}, \text{BALANCED}, \text{DEFENSIVE}, \text{EVASIVE}, \text{STEALTH}\}$.
- Emits the high-level **Goal State** $G^*$ for the GOAP planner and the **Camera Directive** $\mathcal{C}_t$ for the Presentation Director.

**Note on the profile space.** $\mathcal{P}$ is a continuous five-dimensional parameter vector, *not* a choice among a finite set of character classes. Stuntdouble deliberately defines no archetype taxonomy: a protagonist is characterised by where it sits in $\mathcal{P}$, and its descriptive label is free-form metadata. This matters because a taxonomised roster ("operative / vanguard / scholar / skirmisher / guardian") partitions the space into five points and rejects everything between them, which is precisely the failure mode profile alignment is meant to avoid. Empirical estimates $\hat{\mathcal{P}}$ are derived per target game from reverse-engineered behavioural evidence — animation commitment frames for $\alpha$ and $\tau_r$, the parry window for $\delta$, the presence of counter/finisher states for $\phi$, and weapon reach for $r^*$.

### Layer 3A: Makeup-Value Compensated Utility AI ($\mathcal{L}_{3A}$)
To evaluate immediate reflex overrides (such as deflecting an incoming telegraphed attack or executing a vulnerable target), each candidate action $a \in \mathcal{A}_U$ aggregates $n$ normalized considerations $q_i \in [0, 1]$ mapped through response curves (Linear, Polynomial, Logistic Sigmoid).

To prevent actions with higher consideration counts $n$ from suffering multiplicative underflow, Stuntdouble applies **Dave Mark's Makeup Value Compensation**:

$$\mu = 1 - \frac{1}{n}, \qquad \hat{q}_i = q_i + (1 - q_i)\,\mu\,q_i, \qquad U(a) = \prod_{i=1}^{n} \hat{q}_i + \epsilon_{\delta}$$

where $\epsilon_{\delta} \in [-(1-\delta)/10,\ +(1-\delta)/10]$ bounds the stochastic variation so repeated encounters never look robotic. Rather than a platform PRNG (whose stream differs between runtimes and cannot be reproduced in a regression test), Stuntdouble uses the golden-ratio additive recurrence

$$\epsilon_{\delta}^{(k)} = \frac{1-\delta}{10}\Big(2\big(k\varphi^{-1} \bmod 1\big) - 1\Big), \qquad \varphi^{-1} = 0.6180339887498949$$

with $k$ the consideration index within a single tick. This low-discrepancy sequence is deterministic, seed-free and bit-identical in TypeScript, C#, C++ and Lua, which is what allows the four kernels to be differentially tested decision-for-decision.

### Layer 3B: Regressive $A^*$ Goal-Oriented Action Planner ($\mathcal{L}_{3B}$)
Following Jeff Orkin's F.E.A.R. formulation, multi-step tactical sequences (e.g., $\texttt{CLOSE\_DISTANCE} \rightarrow \texttt{HEAVY\_ASSAULT} \rightarrow \texttt{EXECUTE\_FINISHER}$) are synthesized via backward regressive $A^*$ search from the Orchestrator's desired goal proposition set $G^*$ back to the current world state $W_t$:

$$f(n) = g(n) + h(W_t, G_n), \qquad h(W_t, G_n) = \frac{1}{2} \sum_{k \in \text{dom}(G_n)} \mathbb{I}\big(W_t[k] \neq G_n[k]\big)$$

### Layer 2: Tactical Blackboard & 2D Spatial Influence Map ($\mathcal{L}_2$)
Constructs a local $N \times N$ spatial grid centered on the protagonist. Each cell $\mathbf{p}_{u,v}$ accumulates threat and ally control potentials:

$$I(\mathbf{p}_{u,v}) = \sum_{a \in \text{Allies}} \frac{w_a}{1 + \lambda_a \|\mathbf{p}_{u,v} - \mathbf{x}_a\|_2} - \sum_{h \in \text{Hostiles}} \frac{w_h \cdot (1 + 0.75\,\mathbb{I}_{\text{windUp}}(h))}{1 + \lambda_h \|\mathbf{p}_{u,v} - \mathbf{x}_h\|_2}$$

When the Orchestrator transitions into $\text{DEFENSIVE}$ or $\text{EVASIVE}$ stance, the highest-scoring pocket $\arg\max_{\mathbf{p}} I(\mathbf{p})$ becomes the immediate navigation anchor.

### Layer 1: 16-Slot Context Steering ($\mathcal{L}_1$)
Classical vector-sum steering suffers from local minima oscillation when an obstacle sits directly between the agent and its target. Stuntdouble implements **16-Slot Context Steering** (Fray, 2013):
1. Sixteen unit radial basis vectors $\mathbf{d}_k = (\cos \theta_k, 0, \sin \theta_k)$ for $\theta_k = \frac{2\pi k}{16}$ are evaluated per tick.
2. **Interest Array** $I_k \in [0,1]$ rewards alignment toward the optimal combat ring $r^*$.
3. **Danger Array** $D_k \in [0,1]$ projects repulsive cones around hostile wind-up radii and environmental hazards.
4. The conflict-free locomotion vector is selected via:

$$k^* = \arg\max_{k \in \{0..15\}} \big(I_k - \gamma D_k\big), \qquad \gamma = 1.35$$

---

## 2. Tri-Modal Presentation Director

Stuntdouble separates **Cognitive Execution** from **Visual Presentation**, allowing the user to switch modes live via an optional, user-chosen hotkey:

1. **`TACTICAL`:** $\text{TimeScale} = 1.0$, $\text{FOV} = 1.0\times$, $\text{Camera} = \texttt{PASSIVE}$. Standard gameplay view while the Stuntdouble Brain executes combat.
2. **`CINEMATIC_LIVE`:** $\text{Camera} = \texttt{ACTION\_TRACK}$ during movement and $\texttt{IMPACT\_SLOWMO}$ ($\text{TimeScale} = 0.35$, $\text{FOV} = 0.85\times$) during parries, counters, and finishers—turning live gameplay into an interactive action film.
3. **`CINEMATIC_RESOLVE`:** $\text{Camera} = \texttt{FINISH\_CUT}$. Bridges the encounter with a choreographed camera transition while invoking the engine's native encounter-victory callbacks (`Seam.Encounter`) so all quest flags and XP rewards fire cleanly.

---

## 3. References

1. Orkin, J. (2006). *Three States and a Plan: The A.I. of F.E.A.R.* Game Developers Conference (GDC).
2. Mark, D. (2009). *Behavioral Mathematics for Game AI*. Charles River Media.
3. Fray, A. (2013). *Context Behaviors: Know How to Share*. In S. Rabin (Ed.), *Game AI Pro: Collected Wisdom of Game AI Professionals* (Ch. 18). CRC Press.
4. Reynolds, C. W. (1999). *Steering Behaviors For Autonomous Characters*. Game Developers Conference (GDC).
5. Booth, M. (2009). *The AI Systems of Left 4 Dead*. Valve Corporation, GDC.
