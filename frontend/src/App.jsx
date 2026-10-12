import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  ShieldAlert,
  GitBranch,
  Sliders,
  Flame,
  Zap,
  Database,
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Cpu,
  BarChart3,
  Layers,
  ChevronRight,
  Info,
  Upload,
  RefreshCw
} from 'lucide-react';

// Primary production backend on Render
const PRODUCTION_RENDER_BACKEND = 'https://danfoss-92le.onrender.com/api';

// API URL resolution: environment variable > Vercel reverse-proxy /api > direct Render fallback
const envApiBase = import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '') : '';
let currentApiBase = envApiBase || '/api';

const apiFetch = async (endpoint, options = {}) => {
  const url = `${currentApiBase}${endpoint}`;
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.detail) errMsg = errJson.detail;
      } catch (e) {
        // ignore non-json error responses
      }
      throw new Error(errMsg);
    }
    return res;
  } catch (err) {
    // If running on Vercel or localhost and primary URL failed, try direct Render backend
    if (currentApiBase !== PRODUCTION_RENDER_BACKEND) {
      console.warn(`[apiFetch] Primary failed (${url}), falling back to direct Render backend:`, err.message);
      try {
        const fallbackRes = await fetch(`${PRODUCTION_RENDER_BACKEND}${endpoint}`, options);
        if (fallbackRes.ok) {
          currentApiBase = PRODUCTION_RENDER_BACKEND;
          return fallbackRes;
        }
      } catch (fallbackErr) {
        // fall through to localhost fallback if in dev mode
      }
    }
    
    // Dev fallback for local VS Code testing
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && currentApiBase !== 'http://127.0.0.1:8050/api') {
      currentApiBase = 'http://127.0.0.1:8050/api';
      return await fetch(`${currentApiBase}${endpoint}`, options);
    }
    throw err;
  }
};

// -------------------------------------------------------------
// Interactive SVG Chart Component
// -------------------------------------------------------------
const SVGTelemetryChart = ({
  data,
  xKey = 'Time_s',
  yKey = 'Pressure_bar',
  yKey2 = null,
  title,
  yUnit = '',
  yColor = '#0284c7',
  yColor2 = '#9333ea',
  highlightAnomalies = false,
  currentTime = null,
  onSeek = null,
  height = 180
}) => {
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  if (!data || data.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>No data available</div>;
  }

  const cleanData = data.filter(d => d && typeof d === 'object');
  if (cleanData.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>No valid telemetry points</div>;
  }

  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;

  cleanData.forEach(d => {
    const x = Number(d[xKey]);
    const y1 = Number(d[yKey]);
    if (!isNaN(x)) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    if (!isNaN(y1)) {
      if (y1 < yMin) yMin = y1;
      if (y1 > yMax) yMax = y1;
    }
    if (yKey2 && d[yKey2] !== undefined) {
      const y2 = Number(d[yKey2]);
      if (!isNaN(y2)) {
        if (y2 < yMin) yMin = y2;
        if (y2 > yMax) yMax = y2;
      }
    }
  });

  if (!isFinite(xMin) || !isFinite(xMax) || xMin === xMax) {
    xMin = 0;
    xMax = Math.max(1, xMax !== -Infinity ? xMax : 14);
  }
  if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) {
    yMin = 0;
    yMax = Math.max(1, (yMax !== -Infinity ? yMax : 10) + 1);
  }

  const yRange = yMax - yMin;
  const yPad = Math.max(0.1, yRange * 0.1);
  const adjYMin = yMin - yPad;
  const adjYMax = yMax + yPad;

  const width = 600;
  const padding = { top: 20, right: 20, bottom: 30, left: 55 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const getX = val => {
    const n = Number(val);
    const safeVal = isNaN(n) ? 0 : n;
    return padding.left + ((safeVal - xMin) / (xMax - xMin || 1)) * innerW;
  };
  const getY = val => {
    const n = Number(val);
    const safeVal = isNaN(n) ? adjYMin : n;
    return padding.top + innerH - ((safeVal - adjYMin) / (adjYMax - adjYMin || 1)) * innerH;
  };

  const points1 = cleanData.map(d => `${getX(d[xKey])},${getY(d[yKey])}`).join(' ');
  const points2 = yKey2 ? cleanData.map(d => `${getX(d[xKey])},${getY(d[yKey2])}`).join(' ') : null;

  const currentX = currentTime !== null ? getX(currentTime) : null;

  const handleMouseMove = e => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (clientX - padding.left) / innerW));
    const targetX = xMin + ratio * (xMax - xMin);

    // Find closest data point
    let closest = data[0];
    let minDiff = Math.abs(data[0][xKey] - targetX);
    for (let i = 1; i < data.length; i++) {
      const diff = Math.abs(data[i][xKey] - targetX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = data[i];
      }
    }
    setTooltip({
      x: getX(closest[xKey]),
      y: getY(closest[yKey]),
      point: closest
    });
  };

  const handleClick = () => {
    if (tooltip && onSeek) {
      onSeek(tooltip.point[xKey]);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', userSelect: 'none', cursor: onSeek ? 'crosshair' : 'default' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTooltip(null)}
      onClick={handleClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{title}</span>
        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#64748b' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: yColor }}></span>
            {yKey.replace(/_/g, ' ')}
          </span>
          {yKey2 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: yColor2 }}></span>
              {yKey2.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
          const y = padding.top + innerH * (1 - pct);
          const val = adjYMin + pct * (adjYMax - adjYMin);
          return (
            <g key={idx}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3" />
              <text x={padding.left - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="JetBrains Mono">
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* X axis ticks */}
        {[xMin, xMin + (xMax - xMin) * 0.25, xMin + (xMax - xMin) * 0.5, xMin + (xMax - xMin) * 0.75, xMax].map((xVal, idx) => {
          const x = getX(xVal);
          return (
            <g key={idx}>
              <line x1={x} y1={padding.top + innerH} x2={x} y2={padding.top + innerH + 4} stroke="#cbd5e1" strokeWidth="1" />
              <text x={x} y={padding.top + innerH + 16} textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="JetBrains Mono">
                {xVal.toFixed(1)}s
              </text>
            </g>
          );
        })}

        {/* Axis border */}
        <line x1={padding.left} y1={padding.top + innerH} x2={width - padding.right} y2={padding.top + innerH} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + innerH} stroke="#cbd5e1" strokeWidth="1" />

        {/* Series 2 line (e.g. Random Forest Prediction) */}
        {points2 && (
          <polyline fill="none" stroke={yColor2} strokeWidth="2" strokeDasharray="4 3" points={points2} opacity="0.85" />
        )}

        {/* Series 1 line (e.g. Actual) */}
        <polyline fill="none" stroke={yColor} strokeWidth="2" points={points1} strokeLinejoin="round" strokeLinecap="round" />

        {/* Highlight Anomalies with Isolation Forest */}
        {highlightAnomalies && data.map((d, i) => {
          const isAnomaly = d.Is_Anomaly_IsoForest === 1 || d.Sim_Is_Anomaly === 1;
          if (!isAnomaly) return null;
          return (
            <circle
              key={i}
              cx={getX(d[xKey])}
              cy={getY(d[yKey])}
              r="4"
              fill="#ef4444"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          );
        })}

        {/* Scrubber playback cursor */}
        {currentX !== null && currentX >= padding.left && currentX <= width - padding.right && (
          <g>
            <line x1={currentX} y1={padding.top} x2={currentX} y2={padding.top + innerH} stroke="#d92d20" strokeWidth="1.5" strokeDasharray="2 2" />
            <circle cx={currentX} cy={getY(data.find(d => Math.abs(d[xKey] - currentTime) < 0.15)?.[yKey] || adjYMin)} r="4.5" fill="#d92d20" stroke="#fff" strokeWidth="1.5" />
          </g>
        )}

        {/* Tooltip cursor */}
        {tooltip && (
          <g>
            <line x1={tooltip.x} y1={padding.top} x2={tooltip.x} y2={padding.top + innerH} stroke="#64748b" strokeWidth="1" opacity="0.5" />
            <circle cx={tooltip.x} cy={tooltip.y} r="3" fill="#0f172a" />
          </g>
        )}
      </svg>

      {/* Floating tooltip box */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: `${(tooltip.x / width) * 100}%`,
          top: '10px',
          transform: 'translateX(-50%)',
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          padding: '4px 8px',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'JetBrains Mono',
          pointerEvents: 'none',
          boxShadow: '0 4px 6px rgba(0,0,0,0.15)',
          zIndex: 10,
          whiteSpace: 'nowrap'
        }}>
          t: {tooltip.point[xKey].toFixed(2)}s | {yKey}: {tooltip.point[yKey]?.toFixed(2)} {yUnit}
          {yKey2 && tooltip.point[yKey2] !== undefined && ` | ${yKey2}: ${tooltip.point[yKey2]?.toFixed(2)}`}
        </div>
      )}
    </div>
  );
};

// -------------------------------------------------------------
// Animated Hydraulic Cylinder Graphic
// -------------------------------------------------------------
const HydraulicCylinderGraphic = ({ currentPoint }) => {
  // Current values
  const stroke = currentPoint ? currentPoint.Stroke_mm : 300; // 300mm to 50mm
  const pressure = currentPoint ? currentPoint.Pressure_bar : 1.0;
  const flow = currentPoint ? currentPoint.Flow_L_min : 0.0;
  const velocity = currentPoint ? currentPoint.Velocity_mps : 0.0;
  const phase = currentPoint ? currentPoint.Phase : 'IDLE';

  // Physical stroke mapping: 300 mm (TDC) -> y=20px; 50 mm (BDC) -> y=120px
  const travelPct = (300 - stroke) / 250; // 0 at 300mm, 1 at 50mm
  const pistonY = 25 + travelPct * 110;

  // Pressure color intensity (1 bar = light blue #e0f2fe, 167.5 bar = deep warning coral #ef4444)
  const pressNorm = Math.min(1, Math.max(0, (pressure - 1) / 167));
  const headColor = pressNorm > 0.5 ? `rgba(239, 68, 68, ${0.3 + pressNorm * 0.6})` : `rgba(2, 132, 199, ${0.2 + pressNorm * 0.6})`;
  const rodColor = velocity > 0.05 ? 'rgba(16, 185, 129, 0.45)' : 'rgba(226, 232, 240, 0.5)';

  return (
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
      padding: '16px',
      boxShadow: 'var(--shadow-sm)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>Group 3 Actuator Digital Twin</h4>
          <span style={{ fontSize: '11px', color: '#64748b' }}>Bore 75mm | Rod 45mm | 1.5 Ton Dead Load</span>
        </div>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          padding: '3px 8px',
          borderRadius: '9999px',
          backgroundColor: phase.includes('WORKING') ? '#fee2e2' : phase.includes('FAST') ? '#e0f2fe' : '#f1f5f9',
          color: phase.includes('WORKING') ? '#b91c1c' : phase.includes('FAST') ? '#0369a1' : '#475569'
        }}>
          {phase.replace('_', ' ')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        {/* SVG Cylinder Cross Section */}
        <div style={{ width: '140px', height: '240px', position: 'relative' }}>
          <svg viewBox="0 0 140 240" style={{ width: '100%', height: '100%' }}>
            {/* Cylinder Outer Tube / Barrel */}
            <rect x="25" y="15" width="90" height="150" rx="4" fill="#f8fafc" stroke="#475569" strokeWidth="2.5" />
            
            {/* Upper Cylinder Head Cap with Port */}
            <rect x="20" y="10" width="100" height="8" rx="2" fill="#334155" />
            {/* Port A (Head Port) */}
            <rect x="15" y="24" width="12" height="14" fill="#64748b" />
            <text x="7" y="34" fontSize="8" fontWeight="bold" fill="#0284c7">A</text>

            {/* Port B (Rod Port) */}
            <rect x="113" y="145" width="12" height="14" fill="#64748b" />
            <text x="127" y="155" fontSize="8" fontWeight="bold" fill="#10b981">B</text>

            {/* Head Chamber Fluid Area (fills above piston) */}
            <rect x="26.5" y="17.5" width="87" height={Math.max(0, pistonY - 17.5)} fill={headColor} />

            {/* Rod Chamber Fluid Area (fills below piston) */}
            <rect x="26.5" y={pistonY + 16} width="87" height={Math.max(0, 163 - (pistonY + 16))} fill={rodColor} />

            {/* Piston Head (Bore: 75mm representation) */}
            <g style={{ transition: 'all 0.05s ease-out' }}>
              <rect x="27" y={pistonY} width="86" height="16" rx="2" fill="#1e293b" stroke="#0f172a" strokeWidth="1" />
              {/* Piston Wear Seals (PTFE) */}
              <line x1="28" y1={pistonY + 4} x2="31" y2={pistonY + 4} stroke="#ef4444" strokeWidth="2" />
              <line x1="109" y1={pistonY + 4} x2="112" y2={pistonY + 4} stroke="#ef4444" strokeWidth="2" />
              <line x1="28" y1={pistonY + 12} x2="31" y2={pistonY + 12} stroke="#ef4444" strokeWidth="2" />
              <line x1="109" y1={pistonY + 12} x2="112" y2={pistonY + 12} stroke="#ef4444" strokeWidth="2" />

              {/* Piston Rod (Rod: 45mm representation) extending down */}
              <rect x="52" y={pistonY + 16} width="36" height={190 - (pistonY + 16)} fill="#94a3b8" stroke="#475569" strokeWidth="1" />

              {/* Dead Load Platen / Block (1.5 Ton) */}
              <rect x="35" y={190} width="70" height="20" rx="3" fill="#334155" />
              <text x="70" y="203" fontSize="9" fontWeight="bold" fill="#f8fafc" textAnchor="middle">1.5 TON</text>
            </g>

            {/* Lower Cylinder Gland Cap with Rod Seal */}
            <rect x="20" y="163" width="100" height="8" rx="2" fill="#334155" />

            {/* Press Bed / Tooling Anvil at bottom */}
            <rect x="15" y="222" width="110" height="12" rx="2" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1" />
            <text x="70" y="231" fontSize="8" fill="#64748b" textAnchor="middle">PRESS BED</text>
          </svg>
        </div>

        {/* Live Hydro-Mechanical Metrics */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div style={{ backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Stroke Position</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', fontFamily: 'JetBrains Mono' }}>
              {stroke.toFixed(1)} <span style={{ fontSize: '10px', fontWeight: 400 }}>mm</span>
            </span>
          </div>

          <div style={{ backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Ram Velocity</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', fontFamily: 'JetBrains Mono' }}>
              {(velocity * 1000).toFixed(0)} <span style={{ fontSize: '10px', fontWeight: 400 }}>mm/s</span>
            </span>
          </div>

          <div style={{ backgroundColor: pressNorm > 0.5 ? '#fef2f2' : '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '10px', color: pressNorm > 0.5 ? '#b91c1c' : '#64748b', display: 'block' }}>Head Pressure P_head</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: pressNorm > 0.5 ? '#dc2626' : '#0f172a', fontFamily: 'JetBrains Mono' }}>
              {pressure.toFixed(1)} <span style={{ fontSize: '10px', fontWeight: 400 }}>bar</span>
            </span>
          </div>

          <div style={{ backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Pump Flow Q</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#0284c7', fontFamily: 'JetBrains Mono' }}>
              {flow.toFixed(2)} <span style={{ fontSize: '10px', fontWeight: 400 }}>L/min</span>
            </span>
          </div>

          <div style={{ backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #f1f5f9', gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b' }}>Actuation Force:</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155', fontFamily: 'JetBrains Mono' }}>
                {((pressure * 1e5 * 0.00441786) / 1000).toFixed(1)} kN ({((pressure * 1e5 * 0.00441786) / 9810).toFixed(2)} Ton)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// -------------------------------------------------------------
// MAIN DASHBOARD APPLICATION
// -------------------------------------------------------------
export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [telemetryData, setTelemetryData] = useState([]);
  const [telemetrySummary, setTelemetrySummary] = useState(null);
  const [activeFileName, setActiveFileName] = useState('group3_telemetry.csv (Default)');
  const [isCustomFile, setIsCustomFile] = useState(false);
  const [uploadToast, setUploadToast] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [systemSpecs, setSystemSpecs] = useState(null);
  const [modelSummary, setModelSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Auto-dismiss upload toast after 6 seconds
  useEffect(() => {
    if (uploadToast) {
      const timer = setTimeout(() => setUploadToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [uploadToast]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0.0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Isolation Forest tuning state
  const [contamination, setContamination] = useState(0.05);
  const [isRetraining, setIsRetraining] = useState(false);

  // Fault simulation state
  const [simFaultType, setSimFaultType] = useState('seal_leak');
  const [simSeverity, setSimSeverity] = useState(0.6);
  const [simData, setSimData] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Live inference interactive state
  const [liveInput, setLiveInput] = useState({
    stroke_mm: 50.0,
    velocity_mps: -0.01,
    pressure_bar: 167.5,
    flow_L_min: 2.65
  });
  const [livePrediction, setLivePrediction] = useState(null);

  // Initial Data Fetch
  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [telemetryRes, specsRes, modelsRes] = await Promise.all([
        apiFetch('/telemetry'),
        apiFetch('/system-specs'),
        apiFetch('/models/summary')
      ]);
      const telemetry = await telemetryRes.json();
      const specs = await specsRes.json();
      const models = await modelsRes.json();

      setTelemetryData(telemetry.data || []);
      setTelemetrySummary(telemetry.summary || null);
      setActiveFileName(telemetry.active_file_name || 'group3_telemetry.csv (Default)');
      setIsCustomFile(telemetry.is_custom_file || false);
      setSystemSpecs(specs);
      setModelSummary(models);
      if (telemetry.data && telemetry.data.length > 0) {
        setCurrentTime(telemetry.data[0].Time_s);
      }
    } catch (err) {
      console.error('Error fetching initial API data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Playback timer loop
  useEffect(() => {
    let interval = null;
    if (isPlaying && telemetryData.length > 0) {
      const maxTime = telemetryData[telemetryData.length - 1].Time_s;
      interval = setInterval(() => {
        setCurrentTime(prev => {
          const next = prev + 0.1 * playbackSpeed;
          if (next > maxTime) {
            setIsPlaying(false);
            return maxTime;
          }
          return next;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, telemetryData]);

  // Current interpolated point
  const currentPoint = useMemo(() => {
    if (!telemetryData || telemetryData.length === 0) return null;
    let closest = telemetryData[0];
    let minDiff = Math.abs(telemetryData[0].Time_s - currentTime);
    for (let i = 1; i < telemetryData.length; i++) {
      const diff = Math.abs(telemetryData[i].Time_s - currentTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = telemetryData[i];
      }
    }
    return closest;
  }, [telemetryData, currentTime]);

  // Retrain Isolation Forest
  const handleRetrainIsoForest = async () => {
    setIsRetraining(true);
    try {
      const res = await apiFetch('/models/retrain-isolation-forest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contamination: parseFloat(contamination) })
      });
      const data = await res.json();
      setModelSummary(prev => ({
        ...prev,
        isolation_forest: data.metrics
      }));
      // Refresh telemetry with updated anomaly labels
      const telRes = await apiFetch('/telemetry');
      const telJson = await telRes.json();
      setTelemetryData(telJson.data);
      setTelemetrySummary(telJson.summary);
    } catch (err) {
      console.error('Failed to retrain Isolation Forest:', err);
    } finally {
      setIsRetraining(false);
    }
  };

  // Run Fault Simulation
  const handleRunSimulation = async () => {
    setIsSimulating(true);
    try {
      const res = await apiFetch('/simulate-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_type: simFaultType,
          severity: parseFloat(simSeverity)
        })
      });
      const result = await res.json();
      setSimData(result);
    } catch (err) {
      console.error('Simulation error:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  // Run Live Prediction
  const handleLivePredict = async () => {
    try {
      const res = await apiFetch('/predict-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liveInput)
      });
      const out = await res.json();
      setLivePrediction(out);
    } catch (err) {
      console.error('Live predict failed:', err);
    }
  };

  // Handle CSV Upload
  const handleFileUpload = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch('/upload-csv', {
        method: 'POST',
        body: formData
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.detail || 'Upload failed');
      
      setUploadToast({
        type: 'success',
        msg: resData.message || `Loaded '${file.name}' successfully! All models & graphs updated.`
      });
      await fetchInitialData();
    } catch (err) {
      setUploadToast({
        type: 'error',
        msg: `Upload Error: ${err.message}`
      });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  // Reset to default baseline simulation
  const handleResetDefault = async () => {
    setIsUploading(true);
    try {
      const res = await apiFetch('/reset-default-csv', { method: 'POST' });
      const resData = await res.json();
      setUploadToast({
        type: 'info',
        msg: 'Restored baseline Group 3 simulation telemetry.'
      });
      await fetchInitialData();
    } catch (err) {
      setUploadToast({
        type: 'error',
        msg: `Reset Error: ${err.message}`
      });
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
        <div style={{ width: '36px', height: '36px', border: '3px solid #e2e8f0', borderTopColor: '#d92d20', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ marginTop: '16px', fontSize: '14px', color: '#64748b', fontWeight: 500 }}>Initializing Danfoss Group 3 AI Intelligence System...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      {/* ----------------------------------------------------------- */}
      {/* SIDEBAR NAVIGATION */}
      {/* ----------------------------------------------------------- */}
      <aside style={{
        width: '260px',
        backgroundColor: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        zIndex: 20
      }}>
        {/* Brand header */}
        <div style={{ padding: '20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              backgroundColor: '#d92d20',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '12px',
              padding: '2px 6px',
              borderRadius: '4px',
              letterSpacing: '0.5px'
            }}>DANFOSS</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Hydraulic Press</span>
          </div>
          <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10b981' }}></span>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Group 3 Active Config</span>
          </div>
        </div>

        {/* Navigation links */}
        <nav style={{ padding: '12px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { id: 'dashboard', label: 'Cycle & Telemetry', icon: Activity },
            { id: 'isolation_forest', label: 'Isolation Forest (PdM)', icon: ShieldAlert },
            { id: 'random_forest', label: 'Random Forest (AI/ML)', icon: GitBranch },
            { id: 'fault_lab', label: 'Fault Simulation Lab', icon: Flame },
            { id: 'live_predictor', label: 'Live Virtual Sensor', icon: Sliders },
            { id: 'group3_specs', label: 'Group 3 Physics & Energy', icon: Zap },
            { id: 'csv_data', label: 'Uploaded CSV Explorer', icon: Database }
          ].map(item => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: active ? '#f1f5f9' : 'transparent',
                  color: active ? '#0f172a' : '#64748b',
                  fontWeight: active ? 600 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={16} color={active ? '#d92d20' : '#64748b'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Group 3 Hardware Specs Pill in Sidebar Footer */}
        <div style={{ padding: '16px', borderTop: '1px solid #f1f5f9', backgroundColor: '#f8fafc', fontSize: '11px' }}>
          <div style={{ fontWeight: 600, color: '#334155', marginBottom: '4px' }}>Group 3 Mechanical Envelope</div>
          <div style={{ color: '#64748b', lineHeight: '1.6' }}>
            Dead Load: <b style={{ color: '#0f172a' }}>1.5 Ton</b><br />
            Holding Load: <b style={{ color: '#0f172a' }}>6.0 Ton</b><br />
            Bore: <b style={{ color: '#0f172a' }}>75 mm</b> | Rod: <b style={{ color: '#0f172a' }}>45 mm</b><br />
            Motor: <b style={{ color: '#0f172a' }}>1500 RPM</b> (90% Eff)
          </div>
        </div>
      </aside>

      {/* ----------------------------------------------------------- */}
      {/* MAIN CONTENT AREA */}
      {/* ----------------------------------------------------------- */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Playback & Header Bar */}
        <header style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              {activeTab === 'dashboard' && 'Hydraulic Cycle Overview & Telemetry'}
              {activeTab === 'isolation_forest' && 'Unsupervised Anomaly Detection (Isolation Forest)'}
              {activeTab === 'random_forest' && 'Supervised Intelligence & Virtual Sensing (Random Forest)'}
              {activeTab === 'fault_lab' && 'Interactive Fault Injection & What-If Stress Testing'}
              {activeTab === 'live_predictor' && 'Real-Time Inference & Soft Sensor Studio'}
              {activeTab === 'group3_specs' && 'Group 3 Fluid Power Calculations & Energy Optimization'}
              {activeTab === 'csv_data' && 'Uploaded Time-Series Telemetry Table'}
            </h1>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Danfoss Level-1 Solution | Models: Random Forest & Isolation Forest
            </span>
          </div>

          {/* Right Header Action Controls: Scrubber & Real CSV Upload */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Interactive Playback Scrubber */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', backgroundColor: '#f8fafc', padding: '6px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  backgroundColor: isPlaying ? '#d92d20' : '#0284c7',
                  border: 'none',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
                title={isPlaying ? 'Pause Cycle' : 'Play Cycle'}
              >
                {isPlaying ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: '2px' }} />}
              </button>

              <button
                onClick={() => { setIsPlaying(false); setCurrentTime(0.0); }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                title="Reset to 0s"
              >
                <RotateCcw size={14} />
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '160px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontFamily: 'JetBrains Mono' }}>
                  <span>t = {currentTime.toFixed(2)}s</span>
                  <span>{telemetryData.length > 0 ? `${telemetryData[telemetryData.length - 1].Time_s.toFixed(2)}s` : '14.00s'}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={telemetryData.length > 0 ? telemetryData[telemetryData.length - 1].Time_s : 14}
                  step="0.05"
                  value={currentTime}
                  onChange={e => {
                    setIsPlaying(false);
                    setCurrentTime(parseFloat(e.target.value));
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {[1, 2].map(speed => (
                  <button
                    key={speed}
                    onClick={() => setPlaybackSpeed(speed)}
                    style={{
                      padding: '2px 5px',
                      borderRadius: '4px',
                      border: '1px solid',
                      borderColor: playbackSpeed === speed ? '#cbd5e1' : 'transparent',
                      backgroundColor: playbackSpeed === speed ? '#ffffff' : 'transparent',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: playbackSpeed === speed ? '#0f172a' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Header Real CSV Upload Trigger */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '8px',
              backgroundColor: isCustomFile ? '#0284c7' : '#0f172a',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isUploading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: 'var(--shadow-sm)',
              whiteSpace: 'nowrap'
            }}>
              <Upload size={14} />
              {isUploading ? 'Loading...' : isCustomFile ? 'Replace CSV' : 'Upload Real CSV'}
              <input type="file" accept=".csv" onChange={handleFileUpload} disabled={isUploading} style={{ display: 'none' }} />
            </label>

            {isCustomFile && (
              <button
                onClick={handleResetDefault}
                disabled={isUploading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '7px 10px',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
                title="Reset to default Group 3 baseline simulation"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            )}
          </div>
        </header>

        {/* Tab Body */}
        <div style={{ padding: '24px', flex: 1, maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
          {/* --------------------------------------------------------- */}
          {/* TAB 1: DASHBOARD & TELEMETRY */}
          {/* --------------------------------------------------------- */}
          {activeTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Active Dataset Status & Real Data Quick Upload Banner */}
              <div style={{
                backgroundColor: isCustomFile ? '#f0fdf4' : '#ffffff',
                border: '1px solid',
                borderColor: isCustomFile ? '#86efac' : '#e2e8f0',
                borderRadius: '12px',
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    backgroundColor: isCustomFile ? '#dcfce7' : '#e0f2fe',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isCustomFile ? '#15803d' : '#0284c7'
                  }}>
                    <Database size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                        {isCustomFile ? 'Custom Machine Telemetry Loaded:' : 'Group 3 Baseline Simulation Telemetry:'}
                      </span>
                      <code style={{
                        fontSize: '11px',
                        backgroundColor: isCustomFile ? '#bbf7d0' : '#f1f5f9',
                        color: isCustomFile ? '#14532d' : '#0f172a',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600
                      }}>
                        {activeFileName}
                      </code>
                    </div>
                    <span style={{ fontSize: '11px', color: '#64748b', marginTop: '3px', display: 'block' }}>
                      {telemetryData.length} data rows | Cycle Duration: {telemetrySummary?.duration_s?.toFixed(2) || '0.00'}s | 
                      Peak Pressure: {telemetrySummary?.max_pressure_bar?.toFixed(1) || '0.0'} bar | 
                      All 4 graphs, Digital Twin kinematics, and ML models adapt dynamically to this dataset.
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: isUploading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: 'var(--shadow-sm)'
                  }}>
                    <Upload size={14} />
                    {isUploading ? 'Processing CSV...' : 'Upload Real CSV'}
                    <input type="file" accept=".csv" onChange={handleFileUpload} disabled={isUploading} style={{ display: 'none' }} />
                  </label>

                  {isCustomFile && (
                    <button
                      onClick={handleResetDefault}
                      disabled={isUploading}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#334155',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: isUploading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <RotateCcw size={13} />
                      Reset to Default
                    </button>
                  )}
                </div>
              </div>

              {/* Top Stats Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Active Stroke</span>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', fontFamily: 'JetBrains Mono', marginTop: '4px' }}>
                    {currentPoint ? currentPoint.Stroke_mm.toFixed(1) : '300.0'} <span style={{ fontSize: '12px', fontWeight: 400 }}>mm</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                    TDC: 300mm &rarr; BDC: 50mm
                  </span>
                </div>

                <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Hydraulic Head Pressure</span>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: currentPoint?.Pressure_bar > 100 ? '#dc2626' : '#0f172a', fontFamily: 'JetBrains Mono', marginTop: '4px' }}>
                    {currentPoint ? currentPoint.Pressure_bar.toFixed(1) : '1.0'} <span style={{ fontSize: '12px', fontWeight: 400 }}>bar</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    Working Target: 167.5 bar
                  </span>
                </div>

                <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Pump Volumetric Flow</span>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7', fontFamily: 'JetBrains Mono', marginTop: '4px' }}>
                    {currentPoint ? currentPoint.Flow_L_min.toFixed(2) : '0.00'} <span style={{ fontSize: '12px', fontWeight: 400 }}>L/min</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    Peak Fast-Down: ~53.0 L/min
                  </span>
                </div>

                <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Isolation Forest Status</span>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: currentPoint?.Is_Anomaly_IsoForest === 1 ? '#dc2626' : '#10b981', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    {currentPoint?.Is_Anomaly_IsoForest === 1 ? (
                      <><AlertTriangle size={18} /> ANOMALOUS</>
                    ) : (
                      <><CheckCircle2 size={18} /> NOMINAL</>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    Score: {currentPoint?.Anomaly_Score_IsoForest?.toFixed(3) || '0.000'}
                  </span>
                </div>
              </div>

              {/* Main Visualizer: Cylinder Graphic + Telemetry Charts */}
              <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '20px' }}>
                <HydraulicCylinderGraphic currentPoint={currentPoint} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Pressure Chart with Random Forest Predicted Overlay */}
                  <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                    <SVGTelemetryChart
                      data={telemetryData}
                      xKey="Time_s"
                      yKey="Pressure_bar"
                      yKey2="Predicted_Pressure_bar_RF"
                      title="Hydraulic Head Pressure: Actual vs Random Forest Virtual Sensor"
                      yUnit="bar"
                      yColor="#0284c7"
                      yColor2="#9333ea"
                      highlightAnomalies={true}
                      currentTime={currentTime}
                      onSeek={t => setCurrentTime(t)}
                      height={170}
                    />
                  </div>

                  {/* Stroke & Flow Charts Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                      <SVGTelemetryChart
                        data={telemetryData}
                        xKey="Time_s"
                        yKey="Stroke_mm"
                        title="Piston Stroke Profile x(t)"
                        yUnit="mm"
                        yColor="#10b981"
                        currentTime={currentTime}
                        onSeek={t => setCurrentTime(t)}
                        height={140}
                      />
                    </div>

                    <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                      <SVGTelemetryChart
                        data={telemetryData}
                        xKey="Time_s"
                        yKey="Flow_L_min"
                        title="Volumetric Flow Rate Q(t)"
                        yUnit="L/min"
                        yColor="#0ea5e9"
                        currentTime={currentTime}
                        onSeek={t => setCurrentTime(t)}
                        height={140}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Pressure-Stroke Indicator Diagram (Work Envelope) */}
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>P-x Indicator Diagram (Stamping & Workpiece Plastic Energy)</h3>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Work Envelope ∮ P·dx representing forming energy dissipated in workpiece</span>
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'JetBrains Mono', color: '#0f172a' }}>
                    Holding Energy = 167.5 bar @ 50mm BDC
                  </span>
                </div>
                <SVGTelemetryChart
                  data={telemetryData}
                  xKey="Stroke_mm"
                  yKey="Pressure_bar"
                  title="Pressure vs Stroke (Indicator Curve)"
                  yUnit="bar"
                  yColor="#d92d20"
                  height={150}
                />
              </div>
            </div>
          )}

          {/* --------------------------------------------------------- */}
          {/* TAB 2: ISOLATION FOREST ANOMALY LAB */}
          {/* --------------------------------------------------------- */}
          {activeTab === 'isolation_forest' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Isolation Forest Unsupervised Anomaly Engine</h2>
                    <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', maxWidth: '700px' }}>
                      The Isolation Forest isolates physical outliers by recursively partitioning multi-dimensional hydraulic feature space:
                      <code style={{ marginLeft: '4px', backgroundColor: '#f1f5f9', padding: '2px 4px', borderRadius: '4px' }}>
                        [Stroke, Velocity, Pressure, Flow, Power, dP/dt]
                      </code>. Anomalies represent physical faults like internal piston seal leakage, spool stiction, and cavitation.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>Total Samples</span>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', fontFamily: 'JetBrains Mono' }}>
                        {modelSummary?.isolation_forest?.total_samples || 0}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>Flagged Outliers</span>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#dc2626', fontFamily: 'JetBrains Mono' }}>
                        {modelSummary?.isolation_forest?.detected_anomalies || 0} ({modelSummary?.isolation_forest?.anomaly_percentage || 0}%)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Interactive Contamination Slider */}
                <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                        Contamination Threshold: {(contamination * 100).toFixed(1)}%
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>Lower = stricter; Higher = flags more subtle shifts</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="0.20"
                      step="0.005"
                      value={contamination}
                      onChange={e => setContamination(parseFloat(e.target.value))}
                    />
                  </div>

                  <button
                    onClick={handleRetrainIsoForest}
                    disabled={isRetraining}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: isRetraining ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <RefreshCw size={14} className={isRetraining ? 'animate-spin' : ''} />
                    {isRetraining ? 'Retraining...' : 'Retrain Isolation Forest'}
                  </button>
                </div>
              </div>

              {/* Anomaly Score Timeline Chart */}
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <SVGTelemetryChart
                  data={telemetryData}
                  xKey="Time_s"
                  yKey="Anomaly_Score_IsoForest"
                  title="Isolation Forest Anomaly Score Timeline (Score > 0.6 flags physical defect)"
                  yUnit=""
                  yColor="#dc2626"
                  highlightAnomalies={true}
                  currentTime={currentTime}
                  onSeek={t => setCurrentTime(t)}
                  height={170}
                />
              </div>

              {/* Flagged Anomaly Points Table */}
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '10px' }}>
                  Identified Outlier Timestamps in Group 3 Baseline Trace
                </h3>
                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ padding: '8px' }}>Time (s)</th>
                        <th style={{ padding: '8px' }}>Phase</th>
                        <th style={{ padding: '8px' }}>Pressure (bar)</th>
                        <th style={{ padding: '8px' }}>Flow (L/min)</th>
                        <th style={{ padding: '8px' }}>Anomaly Score</th>
                        <th style={{ padding: '8px' }}>Physical Root Cause</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetryData.filter(d => d.Is_Anomaly_IsoForest === 1).map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', fontFamily: 'JetBrains Mono' }}>
                          <td style={{ padding: '8px', color: '#0f172a', fontWeight: 600 }}>{row.Time_s.toFixed(2)}</td>
                          <td style={{ padding: '8px' }}>
                            <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#334155' }}>
                              {row.Phase}
                            </span>
                          </td>
                          <td style={{ padding: '8px', color: '#dc2626' }}>{row.Pressure_bar.toFixed(1)}</td>
                          <td style={{ padding: '8px' }}>{row.Flow_L_min.toFixed(2)}</td>
                          <td style={{ padding: '8px', fontWeight: 700, color: '#dc2626' }}>{row.Anomaly_Score_IsoForest.toFixed(3)}</td>
                          <td style={{ padding: '8px', fontFamily: 'Inter', color: '#64748b' }}>
                            {row.Time_s < 3.1 ? 'Fast Down to Working valve switching transient & pressure step' : 'High pressure gradient dP/dt at phase boundary'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------- */}
          {/* TAB 3: RANDOM FOREST INTELLIGENCE */}
          {/* --------------------------------------------------------- */}
          {activeTab === 'random_forest' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Dual Model Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* RF Classifier Card */}
                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Cpu size={18} color="#0284c7" />
                      <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>Random Forest Classifier</h2>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#059669', backgroundColor: '#d1fae5', padding: '2px 8px', borderRadius: '9999px' }}>
                      Accuracy: {((modelSummary?.random_forest_classifier?.accuracy || 1.0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                    Supervised multi-class ensemble (100 estimators) classifying cycle phase (<code>FAST_DOWN</code>, <code>WORKING</code>, <code>HOLDING</code>, <code>FAST_UP</code>) based on sensor kinematics.
                  </p>

                  <div style={{ marginTop: '16px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '8px' }}>
                      Feature Importances (MDI):
                    </span>
                    {modelSummary?.random_forest_classifier?.feature_importances && Object.entries(modelSummary.random_forest_classifier.feature_importances).map(([col, imp]) => (
                      <div key={col} style={{ marginBottom: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                          <span style={{ color: '#475569' }}>{col}</span>
                          <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#0f172a' }}>{(imp * 100).toFixed(1)}%</span>
                        </div>
                        <div style={{ width: '100%', height: '6px', backgroundColor: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${imp * 100}%`, height: '100%', backgroundColor: '#0284c7', borderRadius: '3px' }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* RF Regressor Card */}
                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <TrendingUp size={18} color="#9333ea" />
                      <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>Random Forest Regressor (Virtual Sensor)</h2>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#7c3aed', backgroundColor: '#ede9fe', padding: '2px 8px', borderRadius: '9999px' }}>
                      R² Score: {(modelSummary?.random_forest_regressor?.r2_score || 0.99).toFixed(3)}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                    Predicts expected dynamic hydraulic pressure from cylinder position, velocity, and flow. The discrepancy between actual and expected pressure flags mechanical seal and valve degradation.
                  </p>

                  <div style={{ marginTop: '16px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '8px' }}>
                      Feature Importances (Pressure Determinants):
                    </span>
                    {modelSummary?.random_forest_regressor?.feature_importances && Object.entries(modelSummary.random_forest_regressor.feature_importances).map(([col, imp]) => (
                      <div key={col} style={{ marginBottom: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                          <span style={{ color: '#475569' }}>{col}</span>
                          <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#0f172a' }}>{(imp * 100).toFixed(1)}%</span>
                        </div>
                        <div style={{ width: '100%', height: '6px', backgroundColor: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${imp * 100}%`, height: '100%', backgroundColor: '#9333ea', borderRadius: '3px' }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Virtual Sensing Overlay Chart */}
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <SVGTelemetryChart
                  data={telemetryData}
                  xKey="Time_s"
                  yKey="Pressure_bar"
                  yKey2="Predicted_Pressure_bar_RF"
                  title="Virtual Pressure Sensing: Actual Telemetry (Blue) vs Random Forest Regressor (Purple)"
                  yUnit="bar"
                  yColor="#0284c7"
                  yColor2="#9333ea"
                  currentTime={currentTime}
                  onSeek={t => setCurrentTime(t)}
                  height={170}
                />
              </div>

              {/* Residual Analysis */}
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <SVGTelemetryChart
                  data={telemetryData}
                  xKey="Time_s"
                  yKey="Pressure_Residual_bar"
                  title="Dynamic Pressure Residual |P_actual - P_pred_RF| (bar)"
                  yUnit="bar"
                  yColor="#d97706"
                  currentTime={currentTime}
                  onSeek={t => setCurrentTime(t)}
                  height={130}
                />
              </div>
            </div>
          )}

          {/* --------------------------------------------------------- */}
          {/* TAB 4: FAULT INJECTION & WHAT-IF LAB */}
          {/* --------------------------------------------------------- */}
          {activeTab === 'fault_lab' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Interactive Hydraulic Fault Injection Lab</h2>
                <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  Inject synthetic hydraulic faults into Group 3's duty cycle. The synthesized time-series trace is immediately run through both <b>Random Forest</b> and <b>Isolation Forest</b> to test real-time detection sensitivity.
                </p>

                {/* Fault Selector Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '16px' }}>
                  {[
                    { id: 'seal_leak', title: 'Piston Seal Leak', desc: 'Exponential holding pressure decay during 8-10s dwell' },
                    { id: 'valve_stiction', title: 'Valve Spool Stiction', desc: 'Pressure overshoot spike at Fast-Down transition (3.0s)' },
                    { id: 'pump_cavitation', title: 'Pump Cavitation', desc: 'Flow drop & high-frequency pressure ripple during Fast-Down' },
                    { id: 'overload', title: 'Tooling Jam / Overload', desc: 'Excess tonnage exceeding 210 bar in working cycle' }
                  ].map(fault => (
                    <div
                      key={fault.id}
                      onClick={() => setSimFaultType(fault.id)}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1.5px solid',
                        borderColor: simFaultType === fault.id ? '#d92d20' : '#e2e8f0',
                        backgroundColor: simFaultType === fault.id ? '#fef2f2' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 600, color: simFaultType === fault.id ? '#991b1b' : '#1e293b', display: 'block' }}>
                        {fault.title}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                        {fault.desc}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Severity Slider & Simulate Button */}
                <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '20px', backgroundColor: '#f8fafc', padding: '12px 16px', borderRadius: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                        Fault Severity: {(simSeverity * 100).toFixed(0)}%
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>0% = pristine; 100% = critical failure</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={simSeverity}
                      onChange={e => setSimSeverity(parseFloat(e.target.value))}
                    />
                  </div>

                  <button
                    onClick={handleRunSimulation}
                    disabled={isSimulating}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '8px',
                      backgroundColor: '#d92d20',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: isSimulating ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Flame size={16} />
                    {isSimulating ? 'Simulating...' : 'Simulate & Run Models'}
                  </button>
                </div>
              </div>

              {/* Simulation Results Display */}
              {simData && (
                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                        Fault Simulation Outcome: {simData.fault_type.toUpperCase()} (Severity: {(simData.severity * 100).toFixed(0)}%)
                      </h3>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        Isolation Forest flagged <b>{simData.anomalies_detected}</b> abnormal time slices across the 14s duty cycle.
                      </span>
                    </div>
                  </div>

                  {/* Fault Telemetry Chart */}
                  <SVGTelemetryChart
                    data={simData.data}
                    xKey="Time_s"
                    yKey="Pressure_bar"
                    yKey2="Sim_Predicted_Pressure_bar"
                    title="Simulated Fault Pressure Trace (Blue) vs RF Model Expected Pressure (Purple)"
                    yUnit="bar"
                    yColor="#dc2626"
                    yColor2="#9333ea"
                    highlightAnomalies={true}
                    height={180}
                  />

                  {/* Simulated Anomaly Score */}
                  <div style={{ marginTop: '16px' }}>
                    <SVGTelemetryChart
                      data={simData.data}
                      xKey="Time_s"
                      yKey="Sim_Anomaly_Score"
                      title="Isolation Forest Real-Time Anomaly Score under Injected Fault"
                      yUnit=""
                      yColor="#dc2626"
                      highlightAnomalies={true}
                      height={130}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --------------------------------------------------------- */}
          {/* TAB 5: LIVE VIRTUAL SENSOR & PREDICTOR */}
          {/* --------------------------------------------------------- */}
          {activeTab === 'live_predictor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Interactive Live Inference Studio</h2>
                <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  Adjust live hydraulic telemetry parameters below to query both the <b>Random Forest Classifier & Regressor</b> and the <b>Isolation Forest Anomaly Detector</b> synchronously.
                </p>

                {/* Input Sliders */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginTop: '20px' }}>
                  <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#475569', marginBottom: '6px' }}>
                      <span>Stroke (mm)</span>
                      <span style={{ fontWeight: 600, fontFamily: 'JetBrains Mono' }}>{liveInput.stroke_mm} mm</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="300"
                      step="1"
                      value={liveInput.stroke_mm}
                      onChange={e => setLiveInput({ ...liveInput, stroke_mm: parseFloat(e.target.value) })}
                    />
                  </div>

                  <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#475569', marginBottom: '6px' }}>
                      <span>Velocity (m/s)</span>
                      <span style={{ fontWeight: 600, fontFamily: 'JetBrains Mono' }}>{liveInput.velocity_mps} m/s</span>
                    </div>
                    <input
                      type="range"
                      min="-0.25"
                      max="0.25"
                      step="0.01"
                      value={liveInput.velocity_mps}
                      onChange={e => setLiveInput({ ...liveInput, velocity_mps: parseFloat(e.target.value) })}
                    />
                  </div>

                  <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#475569', marginBottom: '6px' }}>
                      <span>Pressure (bar)</span>
                      <span style={{ fontWeight: 600, fontFamily: 'JetBrains Mono' }}>{liveInput.pressure_bar} bar</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="220"
                      step="1"
                      value={liveInput.pressure_bar}
                      onChange={e => setLiveInput({ ...liveInput, pressure_bar: parseFloat(e.target.value) })}
                    />
                  </div>

                  <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#475569', marginBottom: '6px' }}>
                      <span>Flow Rate (L/min)</span>
                      <span style={{ fontWeight: 600, fontFamily: 'JetBrains Mono' }}>{liveInput.flow_L_min} L/min</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="75"
                      step="0.5"
                      value={liveInput.flow_L_min}
                      onChange={e => setLiveInput({ ...liveInput, flow_L_min: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleLivePredict}
                    style={{
                      padding: '10px 24px',
                      borderRadius: '8px',
                      backgroundColor: '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Sliders size={16} />
                    Run Model Inferences
                  </button>
                </div>
              </div>

              {/* Inference Output Cards */}
              {livePrediction && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  {/* RF Classifier Outcome */}
                  <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Random Forest Classifier</span>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                      {livePrediction.random_forest.predicted_phase}
                    </div>
                    <span style={{ fontSize: '12px', color: '#10b981', display: 'block', marginTop: '4px' }}>
                      Confidence: {(livePrediction.random_forest.phase_confidence * 100).toFixed(1)}%
                    </span>
                  </div>

                  {/* RF Regressor Virtual Pressure */}
                  <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>RF Virtual Sensor (Pressure)</span>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#7c3aed', fontFamily: 'JetBrains Mono', marginTop: '6px' }}>
                      {livePrediction.random_forest.expected_pressure_bar} <span style={{ fontSize: '12px' }}>bar</span>
                    </div>
                    <span style={{ fontSize: '12px', color: livePrediction.random_forest.pressure_residual_bar > 20 ? '#dc2626' : '#64748b', display: 'block', marginTop: '4px' }}>
                      Discrepancy: {livePrediction.random_forest.pressure_residual_bar} bar
                    </span>
                  </div>

                  {/* Isolation Forest Verdict */}
                  <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Isolation Forest Status</span>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: livePrediction.isolation_forest.is_anomaly ? '#dc2626' : '#10b981', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                      {livePrediction.isolation_forest.is_anomaly ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                      {livePrediction.isolation_forest.status}
                    </div>
                    <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginTop: '4px' }}>
                      Anomaly Probability: {(livePrediction.isolation_forest.anomaly_score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --------------------------------------------------------- */}
          {/* TAB 6: GROUP 3 PHYSICS & ENERGY AUDIT */}
          {/* --------------------------------------------------------- */}
          {activeTab === 'group3_specs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Group 3 Fluid Power & Mechatronics Calculations</h2>
                <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  Analytical physical validation confirming Group 3 parameters against the simulation dataset.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
                  <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Cylinder Geometry</span>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginTop: '6px', lineHeight: '1.6' }}>
                      Bore Area A_head: <b>44.18 cm²</b><br />
                      Rod Area A_rod: <b>15.90 cm²</b><br />
                      Annular Area A_ann: <b>28.27 cm²</b><br />
                      Area Ratio &phi;: <b>1.56</b>
                    </div>
                  </div>

                  <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Force & Pressure Balance</span>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginTop: '6px', lineHeight: '1.6' }}>
                      Dead Load: <b>1.5 Ton (14.72 kN)</b><br />
                      Holding Load: <b>6.0 Ton (58.86 kN)</b><br />
                      Total Work Force: <b>73.58 kN</b><br />
                      Holding Pressure: <b>167.5 bar</b>
                    </div>
                  </div>

                  <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Motor & Pump Efficiencies</span>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginTop: '6px', lineHeight: '1.6' }}>
                      Motor Speed: <b>1500 RPM</b><br />
                      Pump Volumetric Eff: <b>90%</b><br />
                      Pump-to-Cylinder Loss: <b>10 bar</b><br />
                      Cycle Active Time: <b>9.25 s</b>
                    </div>
                  </div>
                </div>
              </div>

              {/* Energy Optimization: VFD Speed Governor */}
              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      Danfoss VLT / VFD Speed Control & Energy Reduction Analysis
                    </h3>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      Comparing constant 1500 RPM fixed displacement vs intelligent VFD throttling
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#059669', backgroundColor: '#d1fae5', padding: '3px 10px', borderRadius: '9999px' }}>
                    54.2% Estimated Energy Savings
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
                  <div style={{ padding: '14px', backgroundColor: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#991b1b' }}>Baseline Fixed-Speed Architecture (1500 RPM)</span>
                    <p style={{ fontSize: '11px', color: '#7f1d1d', marginTop: '6px', lineHeight: '1.5' }}>
                      Motor spins continuously at 1500 RPM. During the 2-second holding phase and 4.75-second idle phase, oil is dumped across the high-pressure relief valve, dissipating significant energy as heat.
                      <br /><br />
                      <b>Total Cycle Energy: ~168.4 kJ / cycle</b>
                    </p>
                  </div>

                  <div style={{ padding: '14px', backgroundColor: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#065f46' }}>Intelligent AI VFD Controlled Architecture</span>
                    <p style={{ fontSize: '11px', color: '#064e3b', marginTop: '6px', lineHeight: '1.5' }}>
                      Motor throttles to 150 RPM during holding (just compensating micro-leakage) and goes into standby mode (0 RPM) during idle. Piston decompression energy is regenerated.
                      <br /><br />
                      <b>Total Cycle Energy: ~77.1 kJ / cycle (Savings: ~91.3 kJ)</b>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------- */}
          {/* TAB 7: CSV TELEMETRY EXPLORER */}
          {/* --------------------------------------------------------- */}
          {activeTab === 'csv_data' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Uploaded Group 3 Telemetry Data</h2>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      {telemetryData.length} recorded time points with enriched fluid power calculations
                    </span>
                  </div>

                  <label style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <Upload size={14} />
                    Upload Alternate CSV
                    <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                </div>

                <div style={{ marginTop: '16px', maxHeight: '500px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left', fontFamily: 'JetBrains Mono' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#475569', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '8px' }}>Time (s)</th>
                        <th style={{ padding: '8px' }}>Stroke (mm)</th>
                        <th style={{ padding: '8px' }}>Velocity (m/s)</th>
                        <th style={{ padding: '8px' }}>Pressure (bar)</th>
                        <th style={{ padding: '8px' }}>Flow (L/min)</th>
                        <th style={{ padding: '8px' }}>Hyd Power (kW)</th>
                        <th style={{ padding: '8px' }}>Phase</th>
                        <th style={{ padding: '8px' }}>IsoForest Anomaly</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetryData.map((row, idx) => (
                        <tr key={idx} style={{
                          borderBottom: '1px solid #f1f5f9',
                          backgroundColor: row.Is_Anomaly_IsoForest === 1 ? '#fef2f2' : 'transparent'
                        }}>
                          <td style={{ padding: '6px 8px', color: '#0f172a', fontWeight: 600 }}>{row.Time_s.toFixed(2)}</td>
                          <td style={{ padding: '6px 8px' }}>{row.Stroke_mm.toFixed(1)}</td>
                          <td style={{ padding: '6px 8px' }}>{row.Velocity_mps.toFixed(3)}</td>
                          <td style={{ padding: '6px 8px', color: row.Pressure_bar > 100 ? '#dc2626' : '#0f172a' }}>{row.Pressure_bar.toFixed(1)}</td>
                          <td style={{ padding: '6px 8px' }}>{row.Flow_L_min.toFixed(2)}</td>
                          <td style={{ padding: '6px 8px' }}>{row.Hydraulic_Power_kW.toFixed(2)}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#f1f5f9', color: '#334155' }}>
                              {row.Phase}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', color: row.Is_Anomaly_IsoForest === 1 ? '#dc2626' : '#10b981', fontWeight: 600 }}>
                            {row.Is_Anomaly_IsoForest === 1 ? 'ANOMALY' : 'NORMAL'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Floating Upload Toast Notification */}
        {uploadToast && (
          <div style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: uploadToast.type === 'error' ? '#ef4444' : uploadToast.type === 'info' ? '#0284c7' : '#10b981',
            color: '#ffffff',
            padding: '12px 18px',
            borderRadius: '10px',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
            fontWeight: 500,
            zIndex: 9999,
            animation: 'fadeIn 0.2s ease-out'
          }}>
            {uploadToast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            <span>{uploadToast.msg}</span>
            <button
              onClick={() => setUploadToast(null)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '8px', fontSize: '15px' }}
            >
              &times;
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
