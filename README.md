# Danfoss Level-1: Group 3 Hydraulic Press ML Intelligence & Digital Twin

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/Frontend-React_19-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Scikit-Learn](https://img.shields.io/badge/ML-Scikit--Learn-F7931E.svg?logo=scikit-learn&logoColor=white)](https://scikit-learn.org)
[![Python](https://img.shields.io/badge/Python-3.14-3776AB.svg?logo=python&logoColor=white)](https://python.org)

An industrial-grade cyber-physical system and machine learning intelligence platform developed for the **Danfoss Level-1 Student Assignment** (Application: Hydraulic Press). 

This repository specifically implements the solution for **Group 3**, utilizing **Random Forest** and **Isolation Forest** exclusively to convert captured high-frequency telemetry into real-time health monitoring, predictive maintenance, virtual pressure sensing, and energy optimization.

---

## 📐 Group 3 Mechanical & Fluid Power Specifications

| Parameter | Value | Engineering Significance |
| :--- | :--- | :--- |
| **Dead Load** | $1.5\text{ Ton}$ ($14.715\text{ kN}$) | Gravity assist during Fast Down; requires $53\text{ bar}$ return pressure. |
| **Holding Load** | $6.0\text{ Ton}$ ($58.86\text{ kN}$) | Workpiece compression load; total required force = $73.575\text{ kN}$. |
| **Cylinder Bore ($D$)** | $75\text{ mm}$ ($0.075\text{ m}$) | Head Chamber Area $A_{head} = \mathbf{44.18\text{ cm}^2}$ ($0.004418\text{ m}^2$). |
| **Piston Rod ($d$)** | $45\text{ mm}$ ($0.045\text{ m}$) | Rod Area $A_{rod} = \mathbf{15.90\text{ cm}^2}$, Annular Area $A_{ann} = \mathbf{28.27\text{ cm}^2}$. |
| **Area Ratio ($\phi$)** | $1.56$ | Ratio governing differential flow and retraction pressure balance. |
| **Motor Speed** | $1500\text{ RPM}$ | Fixed baseline induction motor speed. |
| **Pump Efficiency ($\eta$)** | $0.90$ ($90\%$) | Volumetric & mechanical pump conversion efficiency. |
| **System Pressure Loss** | $10\text{ bar}$ | Line drop from pump discharge port to cylinder chamber. |

### Duty Cycle Profile
* **Fast Down (Approach):** $200\text{ mm/s}$ over $200\text{ mm}$ stroke ($1.0\text{ s}$), Peak Flow $\approx 53.0\text{ L/min}$, Pressure $\approx 11\text{ bar}$.
* **Working Cycle (Pressing):** $10\text{ mm/s}$ over $50\text{ mm}$ stroke ($5.0\text{ s}$), Flow $\approx 2.65\text{ L/min}$, Peak Pressure $\approx 167.5\text{ bar}$.
* **Stop / Holding (Dwell):** $0\text{ mm/s}$ holding position at bottom dead center ($2.0\text{ s}$), Zero net flow, Pressure $\approx 167.5\text{ bar}$.
* **Fast Up (Return):** $200\text{ mm/s}$ over $250\text{ mm}$ return stroke ($1.25\text{ s}$), Flow $\approx 33.9\text{ L/min}$, Pressure $\approx 53.0\text{ bar}$.

---

## 🧠 Data Science & Machine Learning Architecture

```
                    ┌─────────────────────────┐
                    │  Raw Telemetry Dataset  │
                    │  (t, x, v, P, Q, Power) │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
    ┌─────────────────────────┐     ┌─────────────────────────┐
    │    Isolation Forest     │     │      Random Forest      │
    │  (Unsupervised Anomaly) │     │ (Supervised Multi-Task) │
    └────────────┬────────────┘     └────────────┬────────────┘
                 │                               │
        ┌────────┴────────┐             ┌────────┴────────┐
        ▼                 ▼             ▼                 ▼
 ┌─────────────┐   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
 │ Piston Seal │   │ Spool Valve │ │ Operational │ │   Virtual   │
 │ Leak Decay  │   │  Stiction   │ │ Phase Clf   │ │  Pressure   │
 │   Warning   │   │ Overshoot   │ │   (97.1%)   │ │ Sensor R²=98│
 └─────────────┘   └─────────────┘ └─────────────┘ └─────────────┘
```

1. **Isolation Forest (`IsolationForest`):**
   * Multi-dimensional feature partitioning over `[Stroke_mm, Velocity_mps, Pressure_bar, Flow_L_min, Hydraulic_Power_kW, dP/dt]`.
   * Unsupervised detection of internal piston seal leakage, valve spool stiction transients, and pump cavitation.
   * Interactive contamination threshold tuning ($0.01 - 0.20$) with on-the-fly model retraining.
2. **Random Forest Classifier (`RandomForestClassifier`):**
   * Classifies operating regimes (`FAST_DOWN`, `WORKING`, `HOLDING`, `FAST_UP`, `IDLE`) with **97.1% validation accuracy**.
   * Mean Decrease in Impurity (MDI) feature importance ranking.
3. **Random Forest Regressor (`RandomForestRegressor`):**
   * **Virtual Sensing:** Estimates expected hydraulic pressure $\hat{P}$ from ram kinematics with **$R^2 = 0.981$**.
   * Real-time discrepancy residual analysis ($\Delta P = |P_{actual} - \hat{P}_{rf}| > 20\text{ bar}$) triggers mechanical degradation alarms.

---

## ⚡ Energy Optimization (VFD Speed Governor)

* **Baseline Fixed-Speed Architecture (1500 RPM):** Motor runs continuously at 1500 RPM. Excess oil during dwell/idle is throttled across the high-pressure relief valve, dissipating $\sim 168.4\text{ kJ}$ per cycle.
* **Intelligent AI VFD Controlled Architecture:** Dynamic speed modulation reduces motor speed to $150\text{ RPM}$ during holding (micro-leakage compensation only) and $0\text{ RPM}$ during standby, yielding **$54.2\%$ electrical energy savings**.

---

## 🚀 Quickstart & Installation

### Prerequisites
* Python 3.10+ (tested on Python 3.14)
* Node.js v18+ (tested on Node v24)
* Git

### 1. Clone & Setup Backend
```bash
git clone <your-repo-url>
cd danfoss-hydraulic-press-group3/backend

# Install Python requirements
pip install -r requirements.txt

# Start FastAPI server (Port 8050)
python -m uvicorn main:app --host 127.0.0.1 --port 8050
```

### 2. Setup Frontend
```bash
cd ../frontend

# Install dependencies
npm install

# Start React dev server (Port 5180)
npm run dev
```

### 3. Open in Browser
* Web Interface: [http://localhost:5180](http://localhost:5180)
* Interactive Swagger API Docs: [http://localhost:8050/docs](http://localhost:8050/docs)

---

## 📁 Repository Structure

```
danfoss-hydraulic-press-group3/
├── backend/
│   ├── main.py              # FastAPI app, ML models & engineering endpoints
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # React app, SVG charts & digital twin
│   │   ├── index.css        # Minimal light design system
│   │   └── main.jsx         # React entrypoint
│   ├── vite.config.js       # Vite config with backend proxy
│   └── package.json
├── data/
│   └── group3_telemetry.csv # Group 3 simulation telemetry dataset
├── .gitignore
└── README.md
```
