"""
Danfoss Hydraulic Press - Group 3 AI/ML Analytics Engine
Backend API powered by FastAPI, Scikit-Learn (Random Forest & Isolation Forest), Pandas & NumPy.
"""

import os
import math
import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest, RandomForestClassifier, RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error

app = FastAPI(
    title="Danfoss Hydraulic Press - Group 3 ML Intelligence API",
    description="Mechatronics & Data Science utilization using Random Forest and Isolation Forest",
    version="1.0.0"
)

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")
DEFAULT_CSV_PATH = os.path.join(DATA_DIR, "group3_telemetry.csv")

# -------------------------------------------------------------
# GROUP 3 TECHNICAL SPECIFICATIONS (Danfoss Level-1 Assignment)
# -------------------------------------------------------------
GROUP3_SPECS = {
    "group_id": 3,
    "application": "Industrial Hydraulic Press",
    "dead_load_ton": 1.5,
    "dead_load_kg": 1500.0,
    "dead_load_n": 14715.0,  # 1.5 Ton * 9.81
    "holding_load_ton": 6.0,
    "holding_load_kg": 6000.0,
    "holding_load_n": 58860.0,  # 6.0 Ton * 9.81
    "total_work_load_n": 73575.0, # Dead Load + Holding Load
    "bore_mm": 75.0,
    "bore_m": 0.075,
    "rod_mm": 45.0,
    "rod_m": 0.045,
    "area_head_m2": math.pi * ((0.075 / 2) ** 2),       # 0.00441786 m^2
    "area_rod_m2": math.pi * ((0.045 / 2) ** 2),        # 0.00159043 m^2
    "area_annular_m2": math.pi * ((0.075 / 2) ** 2) - math.pi * ((0.045 / 2) ** 2), # 0.00282743 m^2
    "motor_rpm": 1500,
    "pump_efficiency": 0.90,
    "system_loss_bar": 10.0,
    "system_loss_pa": 10.0 * 1e5,
    "cycle_profile": {
        "fast_down": {"speed_mm_s": 200, "stroke_mm": 200, "time_s": 1.0},
        "working": {"speed_mm_s": 10, "stroke_mm": 50, "time_s": 5.0},
        "holding": {"speed_mm_s": 0, "stroke_mm": 0, "time_s": 2.0},
        "fast_up": {"speed_mm_s": 200, "stroke_mm": 250, "time_s": 1.25}
    }
}

# In-memory storage for datasets and trained models
app_state = {
    "df": None,
    "iso_forest": None,
    "rf_classifier": None,
    "rf_regressor": None,
    "iso_forest_metrics": {},
    "rf_classifier_metrics": {},
    "rf_regressor_metrics": {},
    "contamination": 0.05,
    "active_file_name": "group3_telemetry.csv (Default)",
    "is_custom_file": False
}

def determine_phase(row: pd.Series) -> str:
    """Classify physical cycle phase dynamically based on kinematics & fluid pressure."""
    v = row.get("Velocity_mps", 0.0)
    s = row.get("Stroke_mm", 300.0)
    p = row.get("Pressure_bar", 1.0)
    t = row.get("Time_s", 0.0)
    
    # 1. Fast Down (Rapid descent: high negative velocity)
    if v < -0.05:
        return "FAST_DOWN"
    # 2. Working / Pressing (Controlled descent against workpiece)
    elif -0.05 <= v < -0.003:
        return "WORKING"
    # 3. Fast Up (Rapid return: high positive velocity)
    elif v > 0.05:
        return "FAST_UP"
    # 4. Stationary dwell / Holding / Idle
    else:
        if p > 35.0 and s < 180.0:
            return "HOLDING"
        elif s >= 240.0:
            return "IDLE_PRE" if t < 5.0 else "IDLE_POST"
        else:
            return "HOLDING"

def enrich_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """Enrich raw telemetry with derived Mechatronics & Fluid Power features."""
    df = df.copy()
    
    # 1. Stroke velocity in mm/s
    df["Velocity_mm_s"] = df["Velocity_mps"] * 1000.0
    
    # 2. Pressure in Bar & MPa
    df["Pressure_bar"] = df["Pressure_Pa"] / 1e5
    df["Pressure_MPa"] = df["Pressure_Pa"] / 1e6
    
    # 3. Flow in L/min
    df["Flow_L_min"] = df["Flow_m3ps"].abs() * 60000.0
    
    # 4. Instantaneous Hydraulic Power (kW) = P(Pa) * |Q(m3/s)| / 1000
    df["Hydraulic_Power_kW"] = (df["Pressure_Pa"] * df["Flow_m3ps"].abs()) / 1000.0
    
    # 5. Electric Motor Power (kW) = P_hyd / pump_efficiency (0.9)
    df["Electric_Power_kW"] = df["Hydraulic_Power_kW"] / GROUP3_SPECS["pump_efficiency"]
    
    # 6. Physical Net Actuation Force (kN) = P_head * A_head / 1000
    df["Cylinder_Force_kN"] = (df["Pressure_Pa"] * GROUP3_SPECS["area_head_m2"]) / 1000.0
    
    # 7. Pressure gradient dP/dt
    df["dt"] = df["Time_s"].diff().fillna(0.1).replace(0, 0.001)
    df["Pressure_Gradient_bar_s"] = (df["Pressure_bar"].diff().fillna(0.0) / df["dt"]).clip(-2000, 2000)
    
    # 8. Operational Phase Target Label
    df["Phase"] = df.apply(determine_phase, axis=1)
    
    # 9. Numerical Phase Encoding for Models
    phase_map = {
        "IDLE_PRE": 0,
        "FAST_DOWN": 1,
        "WORKING": 2,
        "HOLDING": 3,
        "FAST_UP": 4,
        "IDLE_POST": 5
    }
    df["Phase_Code"] = df["Phase"].map(phase_map)
    
    return df

def train_models():
    """Train Scikit-Learn Isolation Forest and Random Forest models."""
    df = app_state["df"]
    if df is None:
        return
    
    # ---------------------------------------------------------
    # 1. ISOLATION FOREST (Unsupervised Anomaly Detection)
    # ---------------------------------------------------------
    feature_cols = [
        "Stroke_mm",
        "Velocity_mps",
        "Pressure_bar",
        "Flow_L_min",
        "Hydraulic_Power_kW",
        "Pressure_Gradient_bar_s"
    ]
    
    X_iso = df[feature_cols].copy()
    contamination = app_state["contamination"]
    
    iso_model = IsolationForest(
        n_estimators=120,
        contamination=contamination,
        random_state=42,
        n_jobs=-1
    )
    iso_model.fit(X_iso)
    
    # Calculate anomaly scores (-1 for anomaly, 1 for normal)
    preds = iso_model.predict(X_iso)
    raw_scores = iso_model.decision_function(X_iso) # Lower score = more anomalous
    
    # Normalize score to 0..1 (where 1 is highest anomaly probability)
    # raw_scores range from ~ -0.4 to +0.3
    norm_anomaly_score = (1.0 - (raw_scores - raw_scores.min()) / (raw_scores.max() - raw_scores.min() + 1e-6))
    
    df["Is_Anomaly_IsoForest"] = (preds == -1).astype(int)
    df["Anomaly_Score_IsoForest"] = np.round(norm_anomaly_score, 4)
    
    app_state["iso_forest"] = iso_model
    app_state["iso_forest_metrics"] = {
        "model": "Isolation Forest",
        "contamination": contamination,
        "n_estimators": 120,
        "features": feature_cols,
        "total_samples": len(df),
        "detected_anomalies": int((preds == -1).sum()),
        "anomaly_percentage": float(np.round(((preds == -1).sum() / len(df)) * 100, 2))
    }
    
    # ---------------------------------------------------------
    # 2. RANDOM FOREST CLASSIFIER (Phase & Operational State)
    # ---------------------------------------------------------
    X_rf_clf = df[["Stroke_mm", "Velocity_mps", "Pressure_bar", "Flow_L_min"]]
    y_rf_clf = df["Phase_Code"]
    
    # Safe train-test split handling for arbitrary uploaded datasets
    min_class_count = int(y_rf_clf.value_counts().min()) if len(y_rf_clf) > 0 else 0
    strat = y_rf_clf if min_class_count >= 2 else None
    test_sz = 0.25 if len(df) >= 12 else 0.1
    
    if len(df) >= 6:
        X_train_c, X_test_c, y_train_c, y_test_c = train_test_split(
            X_rf_clf, y_rf_clf, test_size=test_sz, random_state=42, stratify=strat
        )
    else:
        X_train_c, X_test_c, y_train_c, y_test_c = X_rf_clf, X_rf_clf, y_rf_clf, y_rf_clf
    
    rf_clf = RandomForestClassifier(
        n_estimators=100,
        max_depth=8,
        random_state=42,
        n_jobs=-1
    )
    rf_clf.fit(X_train_c, y_train_c)
    
    y_pred_c = rf_clf.predict(X_test_c)
    clf_acc = float(accuracy_score(y_test_c, y_pred_c))
    
    # Feature importances
    clf_importances = {
        col: float(np.round(imp, 4))
        for col, imp in zip(X_rf_clf.columns, rf_clf.feature_importances_)
    }
    
    app_state["rf_classifier"] = rf_clf
    app_state["rf_classifier_metrics"] = {
        "model": "Random Forest Classifier",
        "task": "Hydraulic Cycle Phase Recognition",
        "accuracy": clf_acc,
        "test_samples": len(y_test_c),
        "feature_importances": clf_importances,
        "classes": ["IDLE_PRE", "FAST_DOWN", "WORKING", "HOLDING", "FAST_UP", "IDLE_POST"]
    }
    
    # ---------------------------------------------------------
    # 3. RANDOM FOREST REGRESSOR (Virtual Sensing / Pressure Estimator)
    # ---------------------------------------------------------
    # Predicts expected hydraulic pressure based on kinematic state and flow
    X_rf_reg = df[["Stroke_mm", "Velocity_mps", "Flow_L_min", "Phase_Code"]]
    y_rf_reg = df["Pressure_bar"]
    
    if len(df) >= 6:
        X_train_r, X_test_r, y_train_r, y_test_r = train_test_split(
            X_rf_reg, y_rf_reg, test_size=test_sz, random_state=42
        )
    else:
        X_train_r, X_test_r, y_train_r, y_test_r = X_rf_reg, X_rf_reg, y_rf_reg, y_rf_reg
    
    rf_reg = RandomForestRegressor(
        n_estimators=100,
        max_depth=10,
        random_state=42,
        n_jobs=-1
    )
    rf_reg.fit(X_train_r, y_train_r)
    
    y_pred_r = rf_reg.predict(X_test_r)
    r2 = float(r2_score(y_train_r if len(y_test_r) == 0 else y_test_r, y_pred_r))
    mae = float(mean_absolute_error(y_test_r, y_pred_r))
    
    reg_importances = {
        col: float(np.round(imp, 4))
        for col, imp in zip(X_rf_reg.columns, rf_reg.feature_importances_)
    }
    
    # Generate full predicted pressure column for discrepancy detection
    df["Predicted_Pressure_bar_RF"] = np.round(rf_reg.predict(X_rf_reg), 2)
    df["Pressure_Residual_bar"] = np.round((df["Pressure_bar"] - df["Predicted_Pressure_bar_RF"]).abs(), 2)
    
    app_state["rf_regressor"] = rf_reg
    app_state["rf_regressor_metrics"] = {
        "model": "Random Forest Regressor",
        "task": "Virtual Sensing of Expected Hydraulic Pressure",
        "r2_score": max(0.0, r2),
        "mae_bar": mae,
        "feature_importances": reg_importances
    }

# Initialize data on startup
@app.on_event("startup")
def load_and_initialize():
    if os.path.exists(DEFAULT_CSV_PATH):
        df_raw = pd.read_csv(DEFAULT_CSV_PATH)
        app_state["df"] = enrich_dataset(df_raw)
        train_models()
        print(f"Loaded Group 3 dataset: {len(app_state['df'])} rows. Models trained successfully.")
    else:
        print(f"Warning: Default CSV not found at {DEFAULT_CSV_PATH}")

# -------------------------------------------------------------
# REST ENDPOINTS
# -------------------------------------------------------------

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "dataset_loaded": app_state["df"] is not None,
        "rows": len(app_state["df"]) if app_state["df"] is not None else 0,
        "models_active": ["Random Forest Classifier", "Random Forest Regressor", "Isolation Forest"]
    }

@app.get("/api/system-specs")
def get_system_specs():
    """Return Group 3 hydraulic press hardware and operational specifications."""
    return GROUP3_SPECS

@app.get("/api/telemetry")
def get_telemetry():
    """Return full enriched telemetry data."""
    df = app_state["df"]
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not loaded")
    
    # Convert dataframe to list of dicts for JSON
    records = df.to_dict(orient="records")
    
    # Compute integral of electric power over time
    trapz_fn = getattr(np, 'trapezoid', getattr(np, 'trapz', None))
    total_energy = float(trapz_fn(df["Electric_Power_kW"], df["Time_s"])) if trapz_fn else 0.0

    return {
        "count": len(records),
        "data": records,
        "active_file_name": app_state.get("active_file_name", "group3_telemetry.csv (Default)"),
        "is_custom_file": app_state.get("is_custom_file", False),
        "summary": {
            "duration_s": float(df["Time_s"].max()),
            "max_pressure_bar": float(df["Pressure_bar"].max()),
            "max_flow_L_min": float(df["Flow_L_min"].max()),
            "peak_electric_power_kW": float(df["Electric_Power_kW"].max()),
            "total_cycle_energy_kJ": total_energy,
            "detected_anomalies_count": int(df["Is_Anomaly_IsoForest"].sum())
        }
    }

@app.get("/api/models/summary")
def get_models_summary():
    """Return metrics and feature importances for Random Forest and Isolation Forest."""
    return {
        "isolation_forest": app_state["iso_forest_metrics"],
        "random_forest_classifier": app_state["rf_classifier_metrics"],
        "random_forest_regressor": app_state["rf_regressor_metrics"]
    }

class ContaminationUpdate(BaseModel):
    contamination: float

@app.post("/api/models/retrain-isolation-forest")
def retrain_isolation_forest(payload: ContaminationUpdate):
    """Adjust contamination threshold and retrain Isolation Forest."""
    if not (0.001 <= payload.contamination <= 0.25):
        raise HTTPException(status_code=400, detail="Contamination must be between 0.001 and 0.25")
    
    app_state["contamination"] = payload.contamination
    train_models()
    return {
        "message": f"Isolation Forest retrained with contamination {payload.contamination}",
        "metrics": app_state["iso_forest_metrics"]
    }

class PredictionRequest(BaseModel):
    stroke_mm: float
    velocity_mps: float
    pressure_bar: float
    flow_L_min: float

@app.post("/api/predict-live")
def predict_live(req: PredictionRequest):
    """Live inference endpoint using Random Forest and Isolation Forest."""
    rf_clf = app_state["rf_classifier"]
    rf_reg = app_state["rf_regressor"]
    iso = app_state["iso_forest"]
    
    if not all([rf_clf, rf_reg, iso]):
        raise HTTPException(status_code=500, detail="Models not trained")
    
    flow_m3ps = (req.flow_L_min / 60000.0)
    hyd_power_kW = (req.pressure_bar * 1e5 * flow_m3ps) / 1000.0
    
    # 1. Random Forest Classification
    clf_features = pd.DataFrame([{
        "Stroke_mm": req.stroke_mm,
        "Velocity_mps": req.velocity_mps,
        "Pressure_bar": req.pressure_bar,
        "Flow_L_min": req.flow_L_min
    }])
    pred_phase_code = int(rf_clf.predict(clf_features)[0])
    phase_probs = rf_clf.predict_proba(clf_features)[0]
    
    classes = app_state["rf_classifier_metrics"]["classes"]
    predicted_phase = classes[pred_phase_code] if pred_phase_code < len(classes) else "UNKNOWN"
    
    # 2. Random Forest Regression (Expected Pressure)
    reg_features = pd.DataFrame([{
        "Stroke_mm": req.stroke_mm,
        "Velocity_mps": req.velocity_mps,
        "Flow_L_min": req.flow_L_min,
        "Phase_Code": pred_phase_code
    }])
    expected_pressure_bar = float(np.round(rf_reg.predict(reg_features)[0], 2))
    pressure_residual = float(np.round(abs(req.pressure_bar - expected_pressure_bar), 2))
    
    # 3. Isolation Forest Anomaly Detection
    iso_features = pd.DataFrame([{
        "Stroke_mm": req.stroke_mm,
        "Velocity_mps": req.velocity_mps,
        "Pressure_bar": req.pressure_bar,
        "Flow_L_min": req.flow_L_min,
        "Hydraulic_Power_kW": hyd_power_kW,
        "Pressure_Gradient_bar_s": 0.0
    }])
    is_iso_anomaly = int(iso.predict(iso_features)[0] == -1)
    raw_score = float(iso.decision_function(iso_features)[0])
    
    # Physics & Residual Coupling
    is_residual_anomaly = pressure_residual > 20.0
    is_anomaly = bool(is_iso_anomaly or is_residual_anomaly)
    
    # Normalized Anomaly Probability
    score_boost = min(0.4, (pressure_residual / 50.0) * 0.4) if is_residual_anomaly else 0.0
    norm_score = float(np.round(max(0.0, min(1.0, (0.5 - raw_score) + score_boost)), 4))
    
    return {
        "random_forest": {
            "predicted_phase": predicted_phase,
            "predicted_phase_code": pred_phase_code,
            "phase_confidence": float(np.round(np.max(phase_probs), 4)),
            "expected_pressure_bar": expected_pressure_bar,
            "pressure_residual_bar": pressure_residual,
            "residual_status": "HIGH_DISCREPANCY" if is_residual_anomaly else "NORMAL"
        },
        "isolation_forest": {
            "is_anomaly": is_anomaly,
            "anomaly_score": norm_score,
            "raw_decision_score": raw_score,
            "status": "ANOMALOUS" if is_anomaly else "NORMAL"
        },
        "mechatronics": {
            "hydraulic_power_kW": round(hyd_power_kW, 3),
            "electric_power_kW": round(hyd_power_kW / GROUP3_SPECS["pump_efficiency"], 3),
            "cylinder_force_kN": round((req.pressure_bar * 1e5 * GROUP3_SPECS["area_head_m2"]) / 1000.0, 2)
        }
    }

class SimulationFaultRequest(BaseModel):
    fault_type: str  # 'none', 'seal_leak', 'valve_stiction', 'pump_cavitation', 'overload'
    severity: float  # 0.1 to 1.0 scale

@app.post("/api/simulate-cycle")
def simulate_cycle(req: SimulationFaultRequest):
    """
    Simulate a full 14s Group 3 hydraulic press cycle with optional fault injection.
    Runs the synthesized time-series through Random Forest & Isolation Forest in real time!
    """
    df = app_state["df"]
    if df is None:
        raise HTTPException(status_code=404, detail="Base dataset not loaded")
    
    sim_df = df.copy()
    severity = max(0.1, min(1.0, req.severity))
    
    if req.fault_type == "seal_leak":
        # Simulate internal piston seal leakage: pressure decays rapidly during holding phase
        # holding phase is ~8.0s to 10.0s
        holding_mask = (sim_df["Time_s"] >= 8.0) & (sim_df["Time_s"] <= 10.0)
        decay_factor = np.exp(-1.2 * severity * (sim_df.loc[holding_mask, "Time_s"] - 8.0))
        sim_df.loc[holding_mask, "Pressure_bar"] = sim_df.loc[holding_mask, "Pressure_bar"] * decay_factor
        sim_df.loc[holding_mask, "Pressure_Pa"] = sim_df.loc[holding_mask, "Pressure_bar"] * 1e5
        
    elif req.fault_type == "valve_stiction":
        # Proportional valve spool stiction at transition to working (around t=3.0s)
        trans_mask = (sim_df["Time_s"] >= 2.9) & (sim_df["Time_s"] <= 3.8)
        spike = 60.0 * severity * np.sin(np.pi * (sim_df.loc[trans_mask, "Time_s"] - 2.9) / 0.9)
        sim_df.loc[trans_mask, "Pressure_bar"] += np.maximum(0, spike)
        sim_df.loc[trans_mask, "Pressure_Pa"] = sim_df.loc[trans_mask, "Pressure_bar"] * 1e5
        
    elif req.fault_type == "pump_cavitation":
        # Cavitation during high-flow fast-down phase (t=2.0 to 3.0)
        fd_mask = (sim_df["Time_s"] >= 2.0) & (sim_df["Time_s"] <= 3.0)
        noise = np.random.normal(0, 15.0 * severity, size=fd_mask.sum())
        sim_df.loc[fd_mask, "Pressure_bar"] += noise
        sim_df.loc[fd_mask, "Pressure_Pa"] = sim_df.loc[fd_mask, "Pressure_bar"] * 1e5
        sim_df.loc[fd_mask, "Flow_L_min"] = np.maximum(5.0, sim_df.loc[fd_mask, "Flow_L_min"] - (18.0 * severity))
        
    elif req.fault_type == "overload":
        # Workpiece overfill / tooling jamming: pressure rises above 210 bar during working phase
        work_mask = (sim_df["Time_s"] >= 4.0) & (sim_df["Time_s"] <= 8.0)
        sim_df.loc[work_mask, "Pressure_bar"] += (50.0 * severity)
        sim_df.loc[work_mask, "Pressure_Pa"] = sim_df.loc[work_mask, "Pressure_bar"] * 1e5

    # Recompute derived powers and gradients
    sim_df["Hydraulic_Power_kW"] = (sim_df["Pressure_Pa"] * (sim_df["Flow_L_min"] / 60000.0)) / 1000.0
    sim_df["Electric_Power_kW"] = sim_df["Hydraulic_Power_kW"] / GROUP3_SPECS["pump_efficiency"]
    sim_df["Pressure_Gradient_bar_s"] = (sim_df["Pressure_bar"].diff().fillna(0.0) / sim_df["dt"]).clip(-2000, 2000)
    
    # Run through trained Isolation Forest
    iso = app_state["iso_forest"]
    iso_features = sim_df[[
        "Stroke_mm", "Velocity_mps", "Pressure_bar", "Flow_L_min",
        "Hydraulic_Power_kW", "Pressure_Gradient_bar_s"
    ]]
    sim_preds = iso.predict(iso_features)
    raw_scores = iso.decision_function(iso_features)
    sim_df["Sim_Is_Anomaly"] = (sim_preds == -1).astype(int)
    sim_df["Sim_Anomaly_Score"] = np.round((1.0 - (raw_scores - raw_scores.min()) / (raw_scores.max() - raw_scores.min() + 1e-6)), 4)
    
    # Run through trained Random Forest Regressor
    rf_reg = app_state["rf_regressor"]
    sim_df["Sim_Predicted_Pressure_bar"] = np.round(rf_reg.predict(sim_df[["Stroke_mm", "Velocity_mps", "Flow_L_min", "Phase_Code"]]), 2)
    sim_df["Sim_Pressure_Residual_bar"] = np.round((sim_df["Pressure_bar"] - sim_df["Sim_Predicted_Pressure_bar"]).abs(), 2)
    
    records = sim_df.to_dict(orient="records")
    return {
        "fault_type": req.fault_type,
        "severity": severity,
        "anomalies_detected": int((sim_preds == -1).sum()),
        "data": records
    }

@app.post("/api/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    """Upload real time-series CSV file with automatic column normalization and auto-derivation."""
    try:
        df_new = pd.read_csv(file.file)
        
        # 1. Normalize column headers (strip spaces, lowercase, clean underscores)
        col_map = {}
        for c in df_new.columns:
            clean = str(c).strip().lower().replace(" ", "_").replace("-", "_")
            if clean in ["time_s", "time", "t", "timestamp", "seconds", "sec"]:
                col_map[c] = "Time_s"
            elif clean in ["stroke_mm", "stroke", "stroke(mm)", "displacement_mm", "disp_mm"]:
                col_map[c] = "Stroke_mm"
            elif clean in ["position_m", "position", "pos_m", "pos"]:
                col_map[c] = "Position_m"
            elif clean in ["velocity_mps", "velocity", "velocity_m_s", "speed", "v"]:
                col_map[c] = "Velocity_mps"
            elif clean in ["pressure_pa", "pressure_pascals", "press_pa"]:
                col_map[c] = "Pressure_Pa"
            elif clean in ["pressure_bar", "pressure", "p_bar", "p_head", "press_bar"]:
                col_map[c] = "Pressure_bar"
            elif clean in ["pressure_mpa", "press_mpa"]:
                col_map[c] = "Pressure_MPa"
            elif clean in ["flow_m3ps", "flow_m3_s", "flow_m3s", "volumetric_flow"]:
                col_map[c] = "Flow_m3ps"
            elif clean in ["flow_l_min", "flow_lpm", "flow", "q"]:
                col_map[c] = "Flow_L_min"
                
        df_new = df_new.rename(columns=col_map)
        
        # 2. Derive missing fundamental columns if needed
        if "Time_s" not in df_new.columns:
            df_new["Time_s"] = np.arange(len(df_new)) * 0.1
            
        if "Stroke_mm" not in df_new.columns and "Position_m" in df_new.columns:
            df_new["Stroke_mm"] = 300.0 - (df_new["Position_m"].abs() * 1000.0)
        elif "Stroke_mm" not in df_new.columns:
            df_new["Stroke_mm"] = 300.0
            
        if "Position_m" not in df_new.columns:
            df_new["Position_m"] = -(300.0 - df_new["Stroke_mm"]) / 1000.0
            
        if "Velocity_mps" not in df_new.columns:
            dt = df_new["Time_s"].diff().fillna(0.1).replace(0, 0.001)
            df_new["Velocity_mps"] = (df_new["Stroke_mm"].diff().fillna(0.0) / 1000.0) / dt
            
        if "Pressure_Pa" not in df_new.columns:
            if "Pressure_bar" in df_new.columns:
                df_new["Pressure_Pa"] = df_new["Pressure_bar"] * 1e5
            elif "Pressure_MPa" in df_new.columns:
                df_new["Pressure_Pa"] = df_new["Pressure_MPa"] * 1e6
            else:
                df_new["Pressure_Pa"] = 100000.0
                
        if "Flow_m3ps" not in df_new.columns:
            if "Flow_L_min" in df_new.columns:
                df_new["Flow_m3ps"] = (df_new["Flow_L_min"] / 60000.0)
            else:
                df_new["Flow_m3ps"] = df_new["Velocity_mps"] * GROUP3_SPECS["area_head_m2"]
                
        enriched = enrich_dataset(df_new)
        app_state["df"] = enriched
        app_state["active_file_name"] = file.filename
        app_state["is_custom_file"] = True
        train_models()
        
        return {
            "status": "success",
            "message": f"Successfully loaded '{file.filename}' ({len(enriched)} data points). All models and graphs updated!",
            "filename": file.filename,
            "rows": len(enriched),
            "anomalies": int(enriched["Is_Anomaly_IsoForest"].sum()),
            "duration_s": float(enriched["Time_s"].max())
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process CSV: {str(e)}")

@app.post("/api/reset-default-csv")
def reset_default_csv():
    """Reset active dataset back to default Group 3 simulation telemetry."""
    if os.path.exists(DEFAULT_CSV_PATH):
        df_raw = pd.read_csv(DEFAULT_CSV_PATH)
        app_state["df"] = enrich_dataset(df_raw)
        app_state["active_file_name"] = "group3_telemetry.csv (Default)"
        app_state["is_custom_file"] = False
        train_models()
        return {
            "status": "success",
            "message": "Reset to default Group 3 telemetry dataset",
            "filename": "group3_telemetry.csv (Default)",
            "rows": len(app_state["df"])
        }
    raise HTTPException(status_code=404, detail="Default CSV not found")
