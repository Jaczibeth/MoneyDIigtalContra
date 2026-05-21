class ApiClient {
  constructor() {
    this.baseURL = (function() {
      const host = window.location.hostname;
      const port = window.location.port || '80';
      if (host === 'localhost' || host === '127.0.0.1') {
        return `http://${host}:${port}`;
      }
      if (host.includes('surge.sh')) return 'https://money-digital.onrender.com';
      return '';
    })();
    this.token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    this.backendAvailable = false;
    this.init();
  }

  async init() {
    try {
      const res = await fetch(`${this.baseURL}/api/auth/me`, {
        headers: this.getHeaders()
      });
      this.backendAvailable = res.ok;
      if (res.ok) console.log('Backend disponible');
      else console.log('Modo offline (localStorage)');
    } catch (e) {
      console.log('Modo offline (localStorage) - backend no disponible');
    }
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('auth_token', token);
      sessionStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_token');
    }
  }

  clearToken() {
    this.setToken(null);
  }

  async isBackendAlive() {
    try {
      const res = await fetch(`${this.baseURL}/api/auth/me`, { headers: this.getHeaders() });
      return res.ok;
    } catch { return false; }
  }

  async register(data) {
    if (this.backendAvailable || await this.isBackendAlive()) {
      const res = await fetch(`${this.baseURL}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      this.setToken(json.token);
      return json;
    }
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    if (users.find(u => u.username === data.username || u.email === data.email)) {
      throw new Error('Usuario o email ya registrado');
    }
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(data.password));
    const hash = Array.prototype.map.call(new Uint8Array(hashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
    const user = {
      id: Date.now().toString(), username: data.username, email: data.email,
      passwordHash: hash, role: data.role || 'estudiante',
      stellarPublic: data.stellarPublic || null,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    localStorage.setItem('users', JSON.stringify(users));
    return { token: null, user };
  }

  async login(username, password) {
    // Intentar con backend primero
    if (this.backendAvailable || await this.isBackendAlive()) {
      try {
        const res = await fetch(`${this.baseURL}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (res.ok) {
          const json = await res.json();
          this.setToken(json.token);
          return json;
        }
      } catch (e) {
        console.log('Backend no disponible para login, usando offline');
      }
    }
    // Fallback a localStorage
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => u.username === username);
    if (!user) throw new Error('Credenciales inválidas. ¿Ya te registraste?');
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const hash = Array.prototype.map.call(new Uint8Array(hashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
    if (user.passwordHash !== hash) throw new Error('Credenciales inválidas. Verifica tu contraseña.');
    return { token: null, user: { id: user.id, username: user.username, email: user.email, role: user.role, stellarPublic: user.stellarPublic } };
  }

  async getMe() {
    if (this.backendAvailable || await this.isBackendAlive()) {
      const res = await fetch(`${this.baseURL}/api/auth/me`, { headers: this.getHeaders() });
      if (!res.ok) return null;
      return await res.json();
    }
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
    return currentUser.username ? currentUser : null;
  }

  async getUsers() {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/users`, { headers: this.getHeaders() });
      return await res.json();
    }
    return JSON.parse(localStorage.getItem('users') || '[]').map(u => ({ id: u.id, username: u.username, email: u.email, role: u.role, stellarPublic: u.stellarPublic }));
  }

  async getStudents() {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/users/students`, { headers: this.getHeaders() });
      return await res.json();
    }
    return JSON.parse(localStorage.getItem('users') || '[]').filter(u => u.role === 'estudiante').map(u => ({ id: u.id, username: u.username, email: u.email, stellarPublic: u.stellarPublic }));
  }

  async getActivities() {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/activities`, { headers: this.getHeaders() });
      return await res.json();
    }
    return JSON.parse(localStorage.getItem('activities') || '[]').filter(a => a.status === 'active');
  }

  async createActivity(data) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/activities`, {
        method: 'POST', headers: this.getHeaders(), body: JSON.stringify(data)
      });
      return await res.json();
    }
    const activities = JSON.parse(localStorage.getItem('activities') || '[]');
    const activity = { id: Date.now().toString(), ...data, createdAt: new Date().toISOString(), status: 'active' };
    activities.push(activity);
    localStorage.setItem('activities', JSON.stringify(activities));
    return activity;
  }

  async deleteActivity(id) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/activities/${id}`, { method: 'DELETE', headers: this.getHeaders() });
      return await res.json();
    }
    const activities = JSON.parse(localStorage.getItem('activities') || '[]');
    const filtered = activities.filter(a => a.id !== id);
    localStorage.setItem('activities', JSON.stringify(filtered));
    return { success: true };
  }

  async getSubmissions(params = {}) {
    const query = new URLSearchParams(params).toString();
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/submissions?${query}`, { headers: this.getHeaders() });
      return await res.json();
    }
    let subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    if (params.activity_id) subs = subs.filter(s => s.activityId === params.activity_id);
    if (params.status) subs = subs.filter(s => s.status === params.status);
    const activities = JSON.parse(localStorage.getItem('activities') || '[]');
    return subs.map(s => {
      const act = activities.find(a => a.id === s.activityId);
      return { ...s, activityTitle: act ? act.title : '', activityTokens: act ? act.tokens : 0 };
    });
  }

  async submitActivity(formData) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/submissions`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${this.token}` }, body: formData
      });
      return await res.json();
    }
    const activityId = formData.get('activityId');
    const comments = formData.get('comments');
    const file = formData.get('file');
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const submission = {
      id: Date.now().toString(), activityId, studentUsername: currentUser.username,
      comments, status: 'pending', submittedAt: new Date().toISOString(),
      reviewedAt: null, reviewedBy: null, reviewComment: null, tokensAwarded: 0
    };
    if (file && file.size > 0) {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve) => {
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
      });
      submission.fileData = dataUrl;
      submission.fileName = file.name;
      submission.fileType = file.type;
      submission.fileSize = file.size;
    }
    submissions.push(submission);
    localStorage.setItem('submissions', JSON.stringify(submissions));
    return submission;
  }

  async reviewSubmission(id, data) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/submissions/${id}/review`, {
        method: 'PUT', headers: this.getHeaders(), body: JSON.stringify(data)
      });
      const json = await res.json();
      if (json.blockchainTxHash) await this.storeBlockchainTx(json);
      return json;
    }
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const idx = submissions.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Submission no encontrada');
    submissions[idx] = { ...submissions[idx], ...data, reviewedAt: new Date().toISOString() };
    const activity = JSON.parse(localStorage.getItem('activities') || '[]').find(a => a.id === submissions[idx].activityId);
    if (data.status === 'approved' && activity) {
      submissions[idx].tokensAwarded = activity.tokens || 0;
    }
    localStorage.setItem('submissions', JSON.stringify(submissions));
    return submissions[idx];
  }

  async getTokens(username) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/tokens/${username}`, { headers: this.getHeaders() });
      return await res.json();
    }
    const stored = localStorage.getItem(`tokens_${username}`);
    if (stored) return JSON.parse(stored);
    return { username, balance: 0, transactions: [] };
  }

  async mintTokens(username, amount, description) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/tokens/mint`, {
        method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ username, amount, description })
      });
      return await res.json();
    }
    const tokens = JSON.parse(localStorage.getItem(`tokens_${username}`) || JSON.stringify({ balance: 0, transactions: [] }));
    tokens.balance += parseInt(amount);
    tokens.transactions.push({
      id: Date.now().toString(), username, amount: parseInt(amount), type: 'earned',
      description: description || 'Tokens minteados', timestamp: new Date().toISOString()
    });
    localStorage.setItem(`tokens_${username}`, JSON.stringify(tokens));
    return tokens;
  }

  async getRewards() {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/rewards`, { headers: this.getHeaders() });
      return await res.json();
    }
    return JSON.parse(localStorage.getItem('rewards') || '[]').filter(r => r.status === 'active');
  }

  async createReward(data) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/rewards`, {
        method: 'POST', headers: this.getHeaders(), body: JSON.stringify(data)
      });
      return await res.json();
    }
    const rewards = JSON.parse(localStorage.getItem('rewards') || '[]');
    const reward = { id: Date.now().toString(), ...data, createdAt: new Date().toISOString(), status: 'active', redeemedCount: 0 };
    rewards.push(reward);
    localStorage.setItem('rewards', JSON.stringify(rewards));
    return reward;
  }

  async redeemReward(rewardId) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/rewards/${rewardId}/redeem`, {
        method: 'POST', headers: this.getHeaders()
      });
      return await res.json();
    }
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
    const rewards = JSON.parse(localStorage.getItem('rewards') || '[]');
    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return { success: false, error: 'Recompensa no encontrada' };
    const tokens = JSON.parse(localStorage.getItem(`tokens_${currentUser.username}`) || JSON.stringify({ balance: 0, transactions: [] }));
    if (tokens.balance < reward.cost) return { success: false, error: 'Tokens insuficientes' };
    tokens.balance -= reward.cost;
    tokens.transactions.push({
      id: Date.now().toString(), username: currentUser.username, amount: -reward.cost, type: 'redeemed',
      rewardId, description: `Canjeado: ${reward.name}`, timestamp: new Date().toISOString()
    });
    localStorage.setItem(`tokens_${currentUser.username}`, JSON.stringify(tokens));
    return { success: true, newBalance: tokens.balance };
  }

  async getStudentStats(username) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/stats/student`, { headers: this.getHeaders() });
      return await res.json();
    }
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]').filter(s => s.studentUsername === username);
    const activities = JSON.parse(localStorage.getItem('activities') || '[]').filter(a => a.status === 'active');
    const tokens = JSON.parse(localStorage.getItem(`tokens_${username}`) || JSON.stringify({ balance: 0, transactions: [] }));
    return {
      totalActivities: activities.length,
      pendingReview: submissions.filter(s => s.status === 'pending').length,
      needsCorrection: submissions.filter(s => s.status === 'needs_correction').length,
      approved: submissions.filter(s => s.status === 'approved').length,
      rejected: submissions.filter(s => s.status === 'rejected').length,
      tokensBalance: tokens.balance,
      tokensEarned: submissions.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.tokensAwarded || 0), 0),
      activitiesCompleted: submissions.filter(s => s.status === 'approved').length,
      progress: activities.length > 0 ? Math.round((submissions.filter(s => s.status === 'approved').length / activities.length) * 100) : 0
    };
  }

  async getTeacherStats(username) {
    if (this.backendAvailable) {
      const res = await fetch(`${this.baseURL}/api/stats/teacher`, { headers: this.getHeaders() });
      return await res.json();
    }
    const activities = JSON.parse(localStorage.getItem('activities') || '[]').filter(a => a.createdBy === username);
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]').filter(s => {
      const act = JSON.parse(localStorage.getItem('activities') || '[]').find(a => a.id === s.activityId);
      return act && act.createdBy === username;
    });
    return {
      totalActivities: activities.length,
      pendingReviews: submissions.filter(s => s.status === 'pending').length,
      totalTokensAwarded: submissions.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.tokensAwarded || 0), 0),
      totalStudents: new Set(submissions.map(s => s.studentUsername)).size
    };
  }

  async getFileUrl(filePath) {
    if (this.backendAvailable && filePath && !filePath.startsWith('data:')) {
      return `${this.baseURL}/api/files/${filePath}`;
    }
    return filePath;
  }

  async storeBlockchainTx(data) {
    try {
      const txs = JSON.parse(localStorage.getItem('blockchain_txs') || '[]');
      txs.push({ ...data, timestamp: new Date().toISOString() });
      localStorage.setItem('blockchain_txs', JSON.stringify(txs));
    } catch (e) {
      console.warn('Error guardando tx hash:', e);
    }
  }
}

const apiClient = new ApiClient();
