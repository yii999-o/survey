/* global window, document, localStorage, fetch */
(function () {
  'use strict';

  class ApiError extends Error {
    constructor(status, data) {
      super((data && (data.error || data.message)) || `请求失败（HTTP ${status}）`);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }

  function getToken() {
    return localStorage.getItem('token');
  }

  function setToken(token) {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  }

  function loginUrl(next) {
    const target = next || location.pathname + location.search;
    return '/login.html?next=' + encodeURIComponent(target);
  }

  function requireAuth() {
    if (!getToken()) {
      location.replace(loginUrl());
      return false;
    }
    return true;
  }

  async function api(path, options) {
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign({}, opts.headers || {});
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const token = getToken();
    if (token) opts.headers.Authorization = 'Bearer ' + token;

    const response = await fetch(path, opts);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!response.ok) {
      if (response.status === 401) setToken(null);
      throw new ApiError(response.status, data);
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function statusLabel(status) {
    return { draft: '草稿', published: '已发布', closed: '已关闭' }[status] || status;
  }

  function logout() {
    setToken(null);
    location.href = '/login.html';
  }

  function readNext() {
    const next = new URLSearchParams(location.search).get('next');
    // 只允许站内相对路径，避免开放重定向。
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
      return next;
    }
    return '/dashboard.html';
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }

  window.SurveyApp = {
    ApiError,
    getToken,
    setToken,
    loginUrl,
    requireAuth,
    api,
    escapeHtml,
    formatDate,
    statusLabel,
    logout,
    readNext,
    copyText
  };
})();
