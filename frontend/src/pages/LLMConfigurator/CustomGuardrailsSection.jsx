import React, { useState } from 'react';
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import configApi from './configApi';

const SOURCE_PRESETS = {
  nvidia: {
    label: 'NVIDIA (Nemotron / NIM)',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    keyPlaceholder: 'nvapi-...',
    modelRequired: true,
    allow_local: false,
  },
  huggingface: {
    label: 'HuggingFace Hosted',
    url: '',
    keyPlaceholder: 'hf_...',
    modelRequired: false,
    allow_local: false,
  },
  local: {
    label: 'Local (Ollama / vLLM / LM Studio)',
    url: 'http://localhost:11434/v1/chat/completions',
    keyPlaceholder: '(optional)',
    modelRequired: true,
    allow_local: true,
  },
  other: {
    label: 'Other',
    url: '',
    keyPlaceholder: 'Bearer token (optional)',
    modelRequired: false,
    allow_local: false,
  },
};

const DEFAULT_FORM = {
  name: '',
  adapter_type: 'http_generic',
  url: '',
  stage: 'both',
  action: 'block',
  fail_mode: 'fail_closed',
  timeout_ms: 3000,
  priority: 1,
  enabled: true,
  allow_local: false,
  secret_ciphertext: '',
  model: '',
  system_prompt: '',
};

export default function CustomGuardrailsSection({ customGuardrails = [], onChange }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState({ ...DEFAULT_FORM });
  const [sourcePreset, setSourcePreset] = useState('nvidia');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [forceSave, setForceSave] = useState(false);
  const [testText, setTestText] = useState('How can I make a bomb?');

  const openModal = (idx = null) => {
    if (idx !== null) {
      setFormData({ ...DEFAULT_FORM, ...customGuardrails[idx] });
      setEditingIndex(idx);
      // Try to guess preset from existing url
      if (customGuardrails[idx].adapter_type === 'openai_chat_safety') {
        const url = customGuardrails[idx].url || '';
        if (url.includes('nvidia.com')) setSourcePreset('nvidia');
        else if (url.includes('localhost') || url.includes('127.0.0.1')) setSourcePreset('local');
        else if (url.includes('huggingface') || url.includes('hf.')) setSourcePreset('huggingface');
        else setSourcePreset('other');
      }
    } else {
      setFormData({ ...DEFAULT_FORM, priority: customGuardrails.length + 1 });
      setEditingIndex(null);
      setSourcePreset('nvidia');
    }
    setTestResult(null);
    setForceSave(false);
    setIsModalOpen(true);
  };

  const closeModal = () => setIsModalOpen(false);

  const applyPreset = (presetKey) => {
    setSourcePreset(presetKey);
    const preset = SOURCE_PRESETS[presetKey];
    setFormData(prev => ({
      ...prev,
      url: preset.url,
      allow_local: preset.allow_local,
    }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await configApi.post('/guardrails/test', {
        text: testText,
        role: 'input',
        guardrail: formData
      });
      const nr = res.data.normalized_response;
      if (nr.parse_error) {
        setTestResult({
          success: false,
          parseError: true,
          rawModelText: nr.raw_model_text || nr.reason,
          data: res.data
        });
      } else {
        setTestResult({ success: true, data: res.data });
      }
    } catch (err) {
      setTestResult({
        success: false,
        error: err.response?.data?.detail || err.message
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!testResult?.success && !forceSave) return;
    const updated = [...customGuardrails];
    // Clean empty optional fields before saving
    const toSave = { ...formData };
    if (!toSave.model) toSave.model = null;
    if (!toSave.system_prompt) toSave.system_prompt = null;
    if (!toSave.secret_ciphertext) toSave.secret_ciphertext = null;

    if (editingIndex !== null) {
      updated[editingIndex] = toSave;
    } else {
      updated.push(toSave);
    }
    updated.sort((a, b) => a.priority - b.priority);
    onChange(updated);
    closeModal();
  };

  const handleDelete = (idx) => onChange(customGuardrails.filter((_, i) => i !== idx));

  const toggleEnabled = (idx) => {
    const updated = [...customGuardrails];
    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
    onChange(updated);
  };

  const isOpenAI = formData.adapter_type === 'openai_chat_safety';
  const preset = SOURCE_PRESETS[sourcePreset];

  return (
    <div className="mt-6 border-t border-border pt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Custom Guardrails</h3>
        <button type="button" onClick={() => openModal()} className="px-3 py-1.5 bg-primary/10 text-primary rounded-btn text-xs font-medium hover:bg-primary/20 transition-colors flex items-center gap-1.5">
          <PlusIcon className="w-3.5 h-3.5" /> Add Custom Guardrail
        </button>
      </div>

      {customGuardrails.length === 0 ? (
        <div className="text-xs text-text-tertiary italic">No custom guardrails configured.</div>
      ) : (
        <div className="space-y-2">
          {customGuardrails.map((cg, idx) => (
            <div key={idx} className={`flex items-center justify-between p-3 border rounded-lg ${cg.enabled ? 'bg-surface border-border' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-text-primary">{cg.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono">Pri: {cg.priority}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{cg.stage}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">{cg.action}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">{cg.adapter_type}</span>
                </div>
                <div className="text-xs text-text-tertiary mt-1 font-mono truncate max-w-md">{cg.url}</div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={cg.enabled} onChange={() => toggleEnabled(idx)} className="w-3.5 h-3.5 text-primary rounded border-gray-300 focus:ring-primary" />
                  <span className="text-xs font-medium text-text-secondary">{cg.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
                <div className="h-4 w-px bg-border"></div>
                <button type="button" onClick={() => openModal(idx)} className="p-1 text-text-tertiary hover:text-primary transition-colors"><PencilIcon className="w-4 h-4" /></button>
                <button type="button" onClick={() => handleDelete(idx)} className="p-1 text-text-tertiary hover:text-red-500 transition-colors"><TrashIcon className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface">
              <h3 className="text-lg font-bold text-text-primary">{editingIndex !== null ? 'Edit' : 'Add'} Custom Guardrail</h3>
              <button type="button" onClick={closeModal} className="p-1 text-text-tertiary hover:text-text-primary"><XMarkIcon className="w-5 h-5" /></button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
              {/* Name + Adapter Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
                  <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border border-border rounded-btn text-sm" placeholder="e.g. Nemotron Safety" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Adapter Type</label>
                  <select value={formData.adapter_type} onChange={e => { setFormData({...formData, adapter_type: e.target.value}); setTestResult(null); }} className="w-full px-3 py-2 border border-border rounded-btn text-sm bg-white">
                    <option value="http_generic">HTTP Generic</option>
                    <option value="huggingface_inference">HuggingFace Inference</option>
                    <option value="openai_chat_safety">OpenAI Chat Safety (NVIDIA/Llama Guard/etc.)</option>
                  </select>
                </div>
              </div>

              {/* Source Preset (only for openai_chat_safety) */}
              {isOpenAI && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <label className="block text-xs font-semibold text-blue-800 mb-2">Source Preset</label>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(SOURCE_PRESETS).map(([key, p]) => (
                      <button key={key} type="button" onClick={() => applyPreset(key)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${sourcePreset === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100'}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-blue-600 mt-2">Presets pre-fill fields below. You can override any value.</p>
                </div>
              )}

              {/* URL */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Endpoint URL</label>
                <input type="text" value={formData.url} onChange={e => setFormData({...formData, url: e.target.value})} className="w-full px-3 py-2 border border-border rounded-btn text-sm font-mono"
                  placeholder={isOpenAI && sourcePreset === 'huggingface' ? 'Paste your HF endpoint URL here' : 'https://api.example.com/v1/chat/completions'} />
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={formData.allow_local} onChange={e => setFormData({...formData, allow_local: e.target.checked})} className="w-3.5 h-3.5 text-primary rounded border-gray-300" />
                  <span className="text-xs text-text-tertiary">Allow Local/Private IPs (Testing only)</span>
                </label>
              </div>

              {/* Model + System Prompt (only for openai_chat_safety) */}
              {isOpenAI && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      Model {preset.modelRequired && <span className="text-red-500">*</span>}
                    </label>
                    <input type="text" value={formData.model || ''} onChange={e => setFormData({...formData, model: e.target.value})} className="w-full px-3 py-2 border border-border rounded-btn text-sm font-mono" placeholder="e.g. nvidia/nemotron-3.5-content-safety" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">System Prompt <span className="text-text-tertiary">(optional)</span></label>
                    <input type="text" value={formData.system_prompt || ''} onChange={e => setFormData({...formData, system_prompt: e.target.value})} className="w-full px-3 py-2 border border-border rounded-btn text-sm" placeholder="Override system prompt (advanced)" />
                  </div>
                </div>
              )}

              {/* Stage / Action / Fail Mode */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Stage</label>
                  <select value={formData.stage} onChange={e => setFormData({...formData, stage: e.target.value})} className="w-full px-3 py-2 border border-border rounded-btn text-sm bg-white">
                    <option value="pre">Pre-call (Input)</option>
                    <option value="post">Post-call (Output)</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Action</label>
                  <select value={formData.action} onChange={e => setFormData({...formData, action: e.target.value})} className="w-full px-3 py-2 border border-border rounded-btn text-sm bg-white">
                    <option value="block">Block</option>
                    <option value="redact">Redact</option>
                    <option value="warn">Warn</option>
                    <option value="log_only">Log Only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Fail Mode</label>
                  <select value={formData.fail_mode} onChange={e => setFormData({...formData, fail_mode: e.target.value})} className="w-full px-3 py-2 border border-border rounded-btn text-sm bg-white">
                    <option value="fail_closed">Fail Closed (Block)</option>
                    <option value="fail_open">Fail Open (Allow)</option>
                  </select>
                </div>
              </div>

              {/* Priority / Timeout */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Priority</label>
                  <input type="number" min="1" value={formData.priority} onChange={e => setFormData({...formData, priority: parseInt(e.target.value) || 1})} className="w-full px-3 py-2 border border-border rounded-btn text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Timeout (ms)</label>
                  <input type="number" min="100" max="30000" step="100" value={formData.timeout_ms} onChange={e => setFormData({...formData, timeout_ms: parseInt(e.target.value) || 3000})} className="w-full px-3 py-2 border border-border rounded-btn text-sm" />
                </div>
              </div>

              {/* Auth Token */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Auth Token (API Key)</label>
                <input type="password" value={formData.secret_ciphertext || ''} onChange={e => setFormData({...formData, secret_ciphertext: e.target.value})}
                  className="w-full px-3 py-2 border border-border rounded-btn text-sm font-mono"
                  placeholder={isOpenAI ? (preset.keyPlaceholder) : 'Bearer token...'} />
                <p className="text-[10px] text-text-tertiary mt-1">Encrypted at rest via Fernet. Sent as <code className="bg-gray-100 px-1 rounded">Authorization: Bearer &lt;key&gt;</code>. Leave blank for unauthenticated endpoints (e.g. local Ollama).</p>
              </div>

              {/* Test Connection */}
              <div className="p-4 bg-surface rounded-lg border border-border">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-text-secondary">Test Connection</h4>
                  <button type="button" onClick={handleTest} disabled={testing || !formData.url || (isOpenAI && preset.modelRequired && !formData.model)} className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
                    {testing ? 'Testing...' : 'Run Test'}
                  </button>
                </div>
                <div className="mb-2">
                  <label className="block text-[10px] font-medium text-text-tertiary mb-1">Test input text:</label>
                  <input type="text" value={testText} onChange={e => setTestText(e.target.value)} className="w-full px-2 py-1.5 border border-border rounded text-xs font-mono" />
                </div>

                {testResult && (
                  <div className={`mt-3 p-3 rounded text-xs font-mono ${testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    {testResult.success ? (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2 font-bold"><CheckIcon className="w-4 h-4" /> Test Successful ({testResult.data.latency_ms.toFixed(0)}ms)</div>
                        <div className="bg-white/50 p-2 rounded space-y-1">
                          <div>Allowed: {testResult.data.normalized_response.allowed ? '✅ Yes (safe)' : '🚫 No (unsafe)'}</div>
                          {testResult.data.normalized_response.reason && <div className="break-words">Reason: {testResult.data.normalized_response.reason}</div>}
                          {testResult.data.normalized_response.categories?.length > 0 && <div>Categories: {testResult.data.normalized_response.categories.join(', ')}</div>}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-1.5 font-bold"><XMarkIcon className="w-4 h-4" /> {testResult.parseError ? 'Parse Error' : 'Test Failed'}</div>
                        <div className="mt-1 break-words">{testResult.parseError ? testResult.rawModelText : testResult.error}</div>
                        {testResult.parseError && testResult.data?.raw_response && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[10px] text-red-600 underline">Show raw API response</summary>
                            <pre className="mt-1 text-[10px] bg-white/50 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap">{JSON.stringify(testResult.data.raw_response, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {testResult && !testResult.success && (
                  <label className="flex items-center gap-2 mt-3 cursor-pointer p-2 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded text-xs font-medium">
                    <input type="checkbox" checked={forceSave} onChange={e => setForceSave(e.target.checked)} className="w-3.5 h-3.5 text-yellow-600 rounded border-yellow-300 focus:ring-yellow-500" />
                    <span>Override and allow saving despite test failure (Dangerous!)</span>
                  </label>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border bg-surface flex items-center justify-end gap-3">
              <button type="button" onClick={closeModal} className="px-4 py-2 bg-white text-text-secondary border border-border rounded-btn text-sm font-medium hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!formData.name || !formData.url || (!testResult?.success && !forceSave)}
                className="px-6 py-2 bg-primary text-white rounded-btn text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                Save Guardrail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
