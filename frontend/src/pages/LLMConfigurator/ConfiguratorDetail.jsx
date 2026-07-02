import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import configApi from './configApi';
import { 
  ArrowLeftIcon, 
  XMarkIcon,
  DocumentDuplicateIcon,
  CheckIcon,
  PlayIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  TrashIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine
} from 'recharts';

// ─── Config Constants ──────────────────────────────────────────────────────
const ENDPOINT_MAP = {
  chat:                 { path: 'chat',                buildBody: (input) => ({ messages: [{ role: 'user', content: input }] }) },
  vision:               { path: 'vision',              buildBody: (input) => ({ messages: [{ role: 'user', content: input }] }) },
  completion:           { path: 'completions',         buildBody: (input) => ({ prompt: input }) },
  embedding:            { path: 'embeddings',          buildBody: (input) => ({ input }) },
  image_generation:     { path: 'images/generations',  buildBody: (input) => ({ prompt: input }) },
  audio_speech:         { path: 'audio/speech',         buildBody: (input) => ({ input, voice: 'alloy' }) },
};

const RANGE_OPTIONS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

const CHART_COLORS = {
  primary: '#2563EB',
  purple: '#7C3AED',
  teal: '#0D9488',
  amber: '#D97706',
  rose: '#E11D48',
  lime: '#65A30D',
  gray: '#6B7280',
};

const MODEL_COLORS = ['#2563EB', '#7C3AED', '#0D9488', '#D97706', '#E11D48', '#65A30D'];

// ─── Animation ─────────────────────────────────────────────────────────────
const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } }
};
const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } }
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = (n, decimals = 0) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Number(n).toFixed(decimals);
};

const fmtCost = (n) => {
  if (n == null || n === 0) return '$0.00';
  if (n < 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
};

const fmtPct = (n) => {
  if (n == null) return '—';
  return (n * 100).toFixed(1) + '%';
};

const deltaPct = (current, previous) => {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous);
};

const DeltaBadge = ({ current, previous, invert = false }) => {
  const delta = deltaPct(current, previous);
  if (delta == null) return null;
  const isPositive = delta >= 0;
  const isGood = invert ? !isPositive : isPositive;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${isGood ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
      {isPositive ? <ArrowTrendingUpIcon className="w-3 h-3" /> : <ArrowTrendingDownIcon className="w-3 h-3" />}
      {Math.abs(delta * 100).toFixed(0)}%
    </span>
  );
};

const EmptyState = ({ message }) => (
  <div className="flex items-center justify-center h-[200px] text-text-tertiary text-sm italic">
    {message}
  </div>
);

const ChartTooltipContent = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white p-3 border border-border rounded-lg shadow-lg text-xs max-w-xs">
      <p className="font-semibold text-text-primary mb-1.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-text-secondary">{p.name}:</span>
          <span className="font-medium text-text-primary">{typeof p.value === 'number' ? fmt(p.value, 1) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────
export default function ConfiguratorDetail() {
  const { fullName } = useParams();
  const navigate = useNavigate();

  // Core state
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(null);

  // Test Panel
  const [testEndpoint, setTestEndpoint] = useState('chat');
  const [testInput, setTestInput] = useState('Hello! How can I help you today?');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Dashboard state
  const [timeRange, setTimeRange] = useState('7d');
  const [summary, setSummary] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [byModel, setByModel] = useState(null);
  const [byOperation, setByOperation] = useState(null);
  const [recentLogs, setRecentLogs] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  // ─── Data Loading ────────────────────────────────────────────────────────
  const loadConfig = async () => {
    try {
      const [confRes, capRes] = await Promise.all([
        configApi.get(`/configs/${fullName}`),
        configApi.get(`/llm/${fullName}/capabilities`).catch(() => ({ data: {} })),
      ]);
      setConfig(confRes.data);
      setCapabilities(capRes.data);
    } catch (err) {
      setErrorMsg('Failed to load configuration details.');
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const [summaryRes, tsRes, modelRes, opRes, logsRes] = await Promise.all([
        configApi.get(`/llm/${fullName}/usage/summary?range=${timeRange}`),
        configApi.get(`/llm/${fullName}/usage/timeseries?range=${timeRange}`),
        configApi.get(`/llm/${fullName}/usage/by-model?range=${timeRange}`),
        configApi.get(`/llm/${fullName}/usage/by-operation?range=${timeRange}`),
        configApi.get(`/llm/${fullName}/logs/recent?limit=50`),
      ]);
      setSummary(summaryRes.data);
      setTimeseries(tsRes.data);
      setByModel(modelRes.data);
      setByOperation(opRes.data);
      setRecentLogs(logsRes.data);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setDashboardLoading(false);
    }
  }, [fullName, timeRange]);

  useEffect(() => { loadConfig(); }, [fullName]);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  // ─── Derived Data ────────────────────────────────────────────────────────
  const tsData = useMemo(() => {
    if (!timeseries?.data) return [];
    return timeseries.data.map(d => ({
      ...d,
      label: d.timestamp?.includes('T00:00:00')
        ? new Date(d.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : new Date(d.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    }));
  }, [timeseries]);

  const hasData = useMemo(() => summary?.current_period?.calls > 0, [summary]);
  const configLimits = timeseries?.config_limits || {};

  // ─── Handlers ────────────────────────────────────────────────────────────
  const copyToClipboard = async (url) => {
    try { await navigator.clipboard.writeText(url); setCopiedUrl(url); setTimeout(() => setCopiedUrl(null), 2000); } catch {}
  };

  const handleDelete = async () => {
    try {
      await configApi.delete(`/configs/${fullName}`);
      navigate('/llm-configurator');
    } catch (err) {
      const detail = err.response?.data?.detail;
      setErrorMsg(typeof detail === 'string' ? detail : 'Failed to delete config');
      setShowDeleteModal(false);
    }
  };

  const handleTestSubmit = async (e) => {
    e.preventDefault();
    if (!testInput.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const builtIn = ENDPOINT_MAP[testEndpoint];
      let urlPath, body;
      if (builtIn) { urlPath = builtIn.path; body = builtIn.buildBody(testInput); }
      else { urlPath = testEndpoint; body = { messages: [{ role: 'user', content: testInput }] }; }
      const { data } = await configApi.post(`/llm/${fullName}/${urlPath}`, body);
      const replyText = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || (data.data ? JSON.stringify(data.data, null, 2) : JSON.stringify(data, null, 2));
      setTestResult({ ok: true, text: replyText, model_used: data.model_used });
      loadDashboard();
    } catch (err) {
      let errText = 'An error occurred';
      if (err.response?.status === 502) errText = 'Provider failure: ' + (typeof err.response?.data?.detail === 'string' ? err.response.data.detail : '502 Bad Gateway');
      else if (err.response?.status === 429) errText = `Rate Limit: ${err.response?.data?.detail?.message || 'Rate limit exceeded'}`;
      else if (err.response?.data?.detail) { const detail = err.response.data.detail; errText = typeof detail === 'string' ? detail : JSON.stringify(detail); }
      setTestResult({ ok: false, text: errText });
    } finally { setTestLoading(false); }
  };

  // ─── Loading / Error States ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] bg-background">
        <div className="flex gap-2">
          {[0,.2,.4].map(d => <motion.div key={d} animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity, delay: d }} className="w-3 h-3 rounded-full bg-primary" />)}
        </div>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex flex-col h-full bg-background p-8">
        <div className="max-w-xl mx-auto text-center space-y-4">
          <ExclamationTriangleIcon className="w-12 h-12 text-danger mx-auto" />
          <h2 className="text-lg font-bold text-text-primary">Configuration Not Found</h2>
          <p className="text-text-secondary">{errorMsg}</p>
          <button onClick={() => navigate('/llm-configurator')} className="px-4 py-2 bg-primary text-white rounded-btn text-sm font-medium">Go Back</button>
        </div>
      </div>
    );
  }

  const sp = summary?.current_period || {};
  const pp = summary?.previous_period;

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto pb-20">
      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-[64px] shrink-0 px-6 lg:px-8 flex items-center justify-between border-b border-border bg-white z-10 sticky top-0"
      >
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/llm-configurator')} className="p-2 -ml-2 text-text-secondary hover:bg-surface rounded-full transition-colors">
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            {config.full_name}
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-badge ${config.status === 'active' ? 'bg-green-50 text-success border border-green-200' : 'bg-surface text-text-tertiary border border-border'}`}>
              {config.status}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center bg-surface border border-border rounded-lg overflow-hidden">
            {RANGE_OPTIONS.map(r => (
              <button
                key={r.value}
                onClick={() => setTimeRange(r.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${timeRange === r.value ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-background'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Link to={`/llm-configurator/${config.full_name}/edit`} className="px-4 py-2 bg-surface border border-border text-text-primary rounded-btn text-sm font-medium hover:bg-background transition-colors shadow-sm">
            Edit Config
          </Link>
          <button onClick={() => setShowDeleteModal(true)} className="px-4 py-2 bg-red-50 text-danger border border-red-200 rounded-btn text-sm font-medium hover:bg-red-100 transition-colors shadow-sm flex items-center gap-1.5">
            <TrashIcon className="w-4 h-4" /> Delete
          </button>
        </div>
      </motion.header>

      {/* Delete Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full border border-border">
              <div className="flex items-center gap-3 mb-4 text-danger"><ExclamationTriangleIcon className="w-6 h-6" /><h3 className="text-lg font-bold">Delete Configuration?</h3></div>
              <p className="text-text-secondary text-sm mb-6">Are you sure you want to delete <span className="font-semibold">{config.full_name}</span>?<br /><br /><span className="font-bold">WARNING:</span> The endpoint will die immediately.</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowDeleteModal(false)} className="px-4 py-2 bg-surface text-text-secondary rounded-btn text-sm font-medium hover:bg-background border border-border transition-all">Cancel</button>
                <button onClick={handleDelete} className="px-4 py-2 bg-danger text-white rounded-btn text-sm font-medium hover:bg-red-700 transition-all">Delete</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="flex-1 max-w-7xl w-full mx-auto px-6 lg:px-8 py-8 space-y-6">

        {/* ─── KPI Stat Row ─────────────────────────────────────────────── */}
        <motion.div variants={cardVariants} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Total Calls', value: fmt(sp.calls), prev: pp?.calls, current: sp.calls },
            { label: 'Total Tokens', value: fmt(sp.total_tokens), prev: pp?.total_tokens, current: sp.total_tokens },
            { label: 'Total Cost', value: fmtCost(sp.cost), prev: pp?.cost, current: sp.cost },
            { label: 'Success Rate', value: fmtPct(sp.success_rate), prev: pp?.success_rate, current: sp.success_rate },
            { label: 'p95 Latency', value: sp.p95_latency_ms ? fmt(sp.p95_latency_ms, 0) + 'ms' : '—', prev: pp?.p95_latency_ms, current: sp.p95_latency_ms, invert: true },
            { label: 'Fallback Triggers', value: fmt(sp.fallback_triggers), prev: pp?.fallback_triggers, current: sp.fallback_triggers, invert: true },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white p-4 rounded-xl border border-border shadow-sm">
              <p className="text-[11px] font-medium text-text-secondary mb-1 truncate">{kpi.label}</p>
              <div className="flex items-end gap-2">
                <span className="text-xl font-bold text-text-primary">{kpi.value}</span>
                {pp && <DeltaBadge current={kpi.current} previous={kpi.prev} invert={kpi.invert} />}
              </div>
            </div>
          ))}
        </motion.div>

        {/* ─── Charts Grid ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Requests Over Time */}
          <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Requests Over Time</h3>
            {!hasData || tsData.length < 2 ? <EmptyState message="Not enough data yet" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={tsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="calls" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} name="Requests" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Tokens Over Time */}
          <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Tokens Over Time</h3>
            {!hasData || tsData.length < 2 ? <EmptyState message="Not enough data yet" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={tsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => fmt(v)} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="prompt_tokens" stackId="1" fill="#DBEAFE" stroke={CHART_COLORS.primary} name="Prompt Tokens" />
                  <Area type="monotone" dataKey="completion_tokens" stackId="1" fill="#EDE9FE" stroke={CHART_COLORS.purple} name="Completion Tokens" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Cost Over Time */}
          <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Cost Over Time</h3>
            {!hasData || tsData.length < 2 ? <EmptyState message="Not enough data yet" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={tsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => '$' + v.toFixed(3)} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="cost" fill="#FEF3C7" stroke={CHART_COLORS.amber} name="Cost (USD)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Latency Over Time */}
          <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Latency Over Time</h3>
            {!hasData || tsData.length < 2 ? <EmptyState message="Not enough latency data captured" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={tsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => fmt(v) + 'ms'} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="avg_latency_ms" stroke={CHART_COLORS.teal} strokeWidth={2} dot={false} name="Avg Latency (ms)" />
                  <Line type="monotone" dataKey="p95_latency_ms" stroke={CHART_COLORS.rose} strokeWidth={2} dot={false} strokeDasharray="4 3" name="p95 Latency (ms)" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Token Throughput (Rate Panel) */}
          <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Token Throughput (tokens/min)</h3>
            {!hasData || tsData.length < 2 ? <EmptyState message="Not enough per-minute samples to show throughput" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={tsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => fmt(v)} domain={[0, dataMax => {
                    const limit = configLimits.tpm_limit || 0;
                    const max = Math.max(dataMax, limit * 1.15);
                    return Math.ceil(max);
                  }]} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="peak_tpm" name="Peak TPM" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                  {configLimits.tpm_limit && (
                    <ReferenceLine
                      y={configLimits.tpm_limit}
                      stroke={CHART_COLORS.rose}
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      label={{ value: `TPM limit · ${fmt(configLimits.tpm_limit)}`, position: 'insideTopRight', fontSize: 10, fill: CHART_COLORS.rose, fontWeight: 600 }}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Request Rate (Rate Panel) */}
          <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Request Rate (req/min)</h3>
            {!hasData || tsData.length < 2 ? <EmptyState message="Not enough per-minute samples to show request rate" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={tsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} domain={[0, dataMax => {
                    const limit = configLimits.rpm_limit || 0;
                    const max = Math.max(dataMax, limit * 1.15);
                    return Math.ceil(max);
                  }]} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="peak_rpm" name="Peak RPM" fill={CHART_COLORS.purple} radius={[4, 4, 0, 0]} />
                  {configLimits.rpm_limit && (
                    <ReferenceLine
                      y={configLimits.rpm_limit}
                      stroke={CHART_COLORS.rose}
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      label={{ value: `RPM limit · ${configLimits.rpm_limit}`, position: 'insideTopRight', fontSize: 10, fill: CHART_COLORS.rose, fontWeight: 600 }}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>
        </div>

        {/* ─── Per-Model Breakdown + Cost by Model + By-Operation ────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Per-Model Breakdown Table */}
          <motion.div variants={cardVariants} className="lg:col-span-2 bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-surface">
              <h3 className="text-sm font-semibold text-text-primary">Per-Model Breakdown</h3>
            </div>
            {!byModel || byModel.length === 0 ? (
              <EmptyState message="No model usage data yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-medium text-text-secondary uppercase tracking-wider bg-white">
                      <th className="px-6 py-3">Model</th>
                      <th className="px-4 py-3 text-right">Calls</th>
                      <th className="px-4 py-3 text-right">Tokens</th>
                      <th className="px-4 py-3 text-right">Cost</th>
                      <th className="px-4 py-3 text-right">Share</th>
                      <th className="px-4 py-3 text-right">Fallbacks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {byModel.map((m, i) => (
                      <tr key={m.model_used} className="hover:bg-surface transition-colors text-sm">
                        <td className="px-6 py-3 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                          <span className="font-mono text-xs text-text-primary truncate max-w-[220px]">{m.model_used}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{m.calls}</td>
                        <td className="px-4 py-3 text-right text-text-secondary">{fmt(m.total_tokens)}</td>
                        <td className="px-4 py-3 text-right text-text-secondary">{fmtCost(m.cost)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(m.share_percentage * 100).toFixed(0)}%`, background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                            </div>
                            <span className="text-xs text-text-secondary w-10 text-right">{fmtPct(m.share_percentage)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {m.fallback_count > 0 ? (
                            <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{m.fallback_count}</span>
                          ) : (
                            <span className="text-text-tertiary">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>

          {/* Cost by Model + By-Operation */}
          <div className="space-y-6">
            {/* Cost by Model */}
            <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
              <h3 className="text-sm font-semibold text-text-primary mb-4">Cost by Model</h3>
              {!byModel || byModel.filter(m => m.cost > 0).length === 0 ? (
                <EmptyState message="No cost data (local models are $0)" />
              ) : (
                <div className="space-y-3">
                  {byModel.filter(m => m.cost > 0).map((m, i) => (
                    <div key={m.model_used} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                        <span className="text-xs font-mono text-text-primary truncate">{m.model_used}</span>
                      </div>
                      <span className="text-sm font-semibold text-text-primary ml-2 shrink-0">{fmtCost(m.cost)}</span>
                    </div>
                  ))}
                  {byModel.filter(m => m.cost === 0 && m.model_used !== '(all models failed)').map(m => (
                    <div key={m.model_used} className="flex items-center justify-between opacity-50">
                      <span className="text-xs font-mono text-text-tertiary truncate">{m.model_used}</span>
                      <span className="text-xs font-medium text-text-tertiary">$0 (local)</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* By-Operation */}
            <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
              <h3 className="text-sm font-semibold text-text-primary mb-4">By Operation</h3>
              {!byOperation || byOperation.length === 0 ? (
                <EmptyState message="No operation data yet" />
              ) : (
                <div className="space-y-3">
                  {byOperation.map((op, i) => {
                    const totalCalls = byOperation.reduce((s, o) => s + o.calls, 0);
                    const pct = totalCalls > 0 ? (op.calls / totalCalls) : 0;
                    return (
                      <div key={op.operation}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono font-semibold text-text-primary">{op.operation}</span>
                          <span className="text-xs text-text-secondary">{op.calls} calls · {fmtCost(op.cost)}</span>
                        </div>
                        <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${(pct * 100).toFixed(0)}%`, background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </div>
        </div>

        {/* ─── Existing Sections (Endpoints, Operations Chain, Test, Restrictions) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Endpoints & Capabilities */}
            <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
              <h2 className="text-base font-semibold text-text-primary mb-4">Endpoints & Capabilities</h2>
              <div className="flex flex-wrap gap-2 mb-6">
                {capabilities?.operations?.map(op => (
                  <span key={op} className="px-2.5 py-1 bg-primary-light text-primary border border-primary/20 text-xs font-semibold rounded-md uppercase tracking-wide">{op}</span>
                ))}
                {capabilities?.vision && (
                  <span className="px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200 text-xs font-semibold rounded-md uppercase tracking-wide flex items-center gap-1">
                    <EyeIcon className="w-3.5 h-3.5" /> Vision
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-text-secondary">Available URLs</h3>
                <div className="space-y-2">
                  {capabilities?.endpoints?.map(url => (
                    <div key={url} className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg group">
                      <span className="font-mono text-xs text-text-primary truncate mr-4">{url}</span>
                      <button onClick={() => copyToClipboard(url)} className="p-1.5 text-text-tertiary hover:text-primary hover:bg-primary-light rounded-md transition-colors shrink-0" title="Copy URL">
                        {copiedUrl === url ? <CheckIcon className="w-4 h-4 text-success" /> : <DocumentDuplicateIcon className="w-4 h-4" />}
                      </button>
                    </div>
                  ))}
                  {(!capabilities?.endpoints || capabilities.endpoints.length === 0) && <div className="text-sm text-text-tertiary">No endpoints resolved.</div>}
                </div>
              </div>
            </motion.div>

            {/* Operations Chain */}
            {config.operations && Object.keys(config.operations).length > 0 && (
              <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
                <h2 className="text-base font-semibold text-text-primary mb-4">Operations Chain</h2>
                <div className="space-y-5">
                  {Object.entries(config.operations).map(([mode, models]) => (
                    <div key={mode}>
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2">{mode}</h3>
                      <div className="space-y-2">
                        {[...models].sort((a, b) => a.priority - b.priority).map((m, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg">
                            <span className="w-5 h-5 flex items-center justify-center bg-primary text-white text-xs font-bold rounded-full shrink-0">{m.priority}</span>
                            <span className="font-mono text-sm text-text-primary truncate">{m.litellm_model}</span>
                            <div className="ml-auto flex items-center gap-2 shrink-0">
                              {m.rpm != null && <span className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">RPM: {m.rpm}</span>}
                              {m.tpm != null && <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">TPM: {m.tpm}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {config.custom_operations && Object.entries(config.custom_operations).map(([opName, opData]) => (
                    <div key={`custom-${opName}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold rounded uppercase">Custom</span>
                        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">{opName}</h3>
                      </div>
                      <div className="mb-2 p-3 bg-gray-50 border border-border rounded-lg text-xs text-text-secondary font-mono whitespace-pre-wrap">{opData.description}</div>
                      <div className="space-y-2">
                        {[...opData.models].sort((a, b) => a.priority - b.priority).map((m, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg">
                            <span className="w-5 h-5 flex items-center justify-center bg-primary text-white text-xs font-bold rounded-full shrink-0">{m.priority}</span>
                            <span className="font-mono text-sm text-text-primary truncate">{m.litellm_model}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Test Panel */}
            <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <PlayIcon className="w-5 h-5 text-primary" />
                  <h2 className="text-base font-semibold text-text-primary">Test Endpoint</h2>
                </div>
                <select value={testEndpoint} onChange={e => setTestEndpoint(e.target.value)} className="px-2 py-1 border border-border rounded text-sm bg-surface font-mono outline-none focus:border-primary">
                  {capabilities?.operations?.map(op => <option key={op} value={op}>/{ENDPOINT_MAP[op]?.path || op}</option>)}
                  {capabilities?.vision && <option value="vision">/vision</option>}
                  {config.custom_operations && Object.keys(config.custom_operations).map(opName => <option key={`custom-${opName}`} value={opName}>/{opName} (custom)</option>)}
                </select>
              </div>
              <form onSubmit={handleTestSubmit} className="space-y-4">
                <textarea rows={3} required value={testInput} onChange={e => setTestInput(e.target.value)} placeholder="Enter a test prompt..." className="w-full px-4 py-3 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background resize-y" />
                <div className="flex justify-end">
                  <button type="submit" disabled={testLoading || !testInput.trim()} className="px-6 py-2 bg-primary text-white rounded-btn text-sm font-medium hover:bg-primary-hover transition-all disabled:opacity-50 flex items-center gap-2">
                    {testLoading ? 'Sending...' : 'Test Endpoint'}
                  </button>
                </div>
              </form>
              <AnimatePresence>
                {testResult && (
                  <motion.div initial={{ opacity: 0, height: 0, marginTop: 0 }} animate={{ opacity: 1, height: 'auto', marginTop: 16 }} className={`p-4 rounded-lg border ${testResult.ok ? 'bg-surface border-border' : 'bg-red-50 border-red-200 text-danger'}`}>
                    {!testResult.ok ? (
                      <div className="flex gap-2"><ExclamationTriangleIcon className="w-5 h-5 shrink-0" /><span className="text-sm font-medium">{testResult.text}</span></div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-text-tertiary uppercase tracking-wider">Response</span>
                          <span className="text-xs bg-white border border-border px-2 py-0.5 rounded-md font-mono text-primary">Model: {testResult.model_used || 'unknown'}</span>
                        </div>
                        <div className="text-sm text-text-primary whitespace-pre-wrap font-mono bg-white p-3 rounded border border-border">{testResult.text}</div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Restrictions & Guardrails */}
            <motion.div variants={cardVariants} className="bg-white p-6 rounded-xl border border-border shadow-sm space-y-6">
              <div>
                <h2 className="text-sm font-semibold text-text-primary mb-3">Restrictions</h2>
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between"><span className="text-text-secondary">RPM</span><span className="font-medium text-text-primary">{config.restrictions?.rpm}</span></li>
                  <li className="flex justify-between"><span className="text-text-secondary">TPM</span><span className="font-medium text-text-primary">{config.restrictions?.tpm}</span></li>
                  <li className="flex justify-between"><span className="text-text-secondary">TPR</span><span className="font-medium text-text-primary">{config.restrictions?.tpr}</span></li>
                </ul>
              </div>
              <div className="pt-4 border-t border-border">
                <h2 className="text-sm font-semibold text-text-primary mb-3">Guardrails</h2>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${config.guardrails?.pii_masking ? 'bg-success' : 'bg-danger'}`} />
                    <span className="text-text-primary">PII Masking</span>
                  </li>
                  <li className="flex items-center gap-2 opacity-60">
                    <span className={`w-2 h-2 rounded-full ${config.guardrails?.profanity_filter ? 'bg-success' : 'bg-danger'}`} />
                    <span className="text-text-primary">Profanity Filter</span>
                  </li>
                </ul>
              </div>
            </motion.div>
          </div>
        </div>

        {/* ─── Recent Logs Table ─────────────────────────────────────────── */}
        <motion.div variants={cardVariants} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-border bg-surface flex items-center justify-between">
            <h2 className="text-base font-semibold text-text-primary">Recent Logs</h2>
            <span className="text-xs text-text-tertiary">{recentLogs?.length || 0} entries</span>
          </div>
          {!recentLogs || recentLogs.length === 0 ? (
            <EmptyState message="No calls logged yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b border-border text-[11px] font-medium text-text-secondary uppercase tracking-wider bg-white">
                    <th className="px-6 py-3">Time</th>
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3 text-right">Tokens</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                    <th className="px-4 py-3 text-right">Latency</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Fallback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentLogs.map(log => (
                    <tr key={log.id} className="hover:bg-surface transition-colors text-sm">
                      <td className="px-6 py-3 text-text-secondary whitespace-nowrap text-xs">
                        {new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{log.operation}</td>
                      <td className="px-4 py-3 text-primary font-mono text-xs truncate max-w-[160px]">{log.model_used || '—'}</td>
                      <td className="px-4 py-3 text-right text-text-secondary text-xs">{log.total_tokens || 0}</td>
                      <td className="px-4 py-3 text-right text-text-secondary text-xs">{fmtCost(log.cost)}</td>
                      <td className="px-4 py-3 text-right text-text-secondary text-xs">{Math.round(log.latency_ms)}ms</td>
                      <td className="px-4 py-3">
                        {log.success ? (
                          <span className="text-success flex items-center gap-1 text-xs"><CheckIcon className="w-3.5 h-3.5" /> OK</span>
                        ) : (
                          <span className="text-danger flex items-center gap-1 text-xs" title={log.error_type}>
                            <XMarkIcon className="w-3.5 h-3.5" /> {log.error_type || 'Err'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.fallback_triggered ? (
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">YES</span>
                        ) : (
                          <span className="text-text-tertiary text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>

      </motion.div>
    </div>
  );
}
