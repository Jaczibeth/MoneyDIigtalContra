class ActivitiesSystem {
  constructor() {
    this.init();
  }

  init() {
    if (!localStorage.getItem('activities')) localStorage.setItem('activities', JSON.stringify([]));
    if (!localStorage.getItem('submissions')) localStorage.setItem('submissions', JSON.stringify([]));
    if (!localStorage.getItem('rewards')) localStorage.setItem('rewards', JSON.stringify([]));
    if (!localStorage.getItem('redemptions')) localStorage.setItem('redemptions', JSON.stringify([]));
  }

  loadUsers() {
    try { return JSON.parse(localStorage.getItem('users') || '[]'); } catch { return []; }
  }

  // ========== ACTIVIDADES (con API fallback) ==========

  async createActivity(data) {
    try { return await apiClient.createActivity(data); }
    catch { return this._createActivityLocal(data); }
  }

  _createActivityLocal(data) {
    const activities = this.getActivities();
    const activity = { id: Date.now().toString(), ...data, createdAt: new Date().toISOString(), status: 'active' };
    activities.push(activity);
    localStorage.setItem('activities', JSON.stringify(activities));
    return activity;
  }

  getActivities() {
    try { return JSON.parse(localStorage.getItem('activities') || '[]'); } catch { return []; }
  }

  getActivityById(id) {
    return this.getActivities().find(a => a.id === id);
  }

  async getActivitiesAsync() {
    try { return await apiClient.getActivities(); } catch { return this.getActivities(); }
  }

  // ========== SUBMISIONES ==========

  async submitActivity(activityId, studentUsername, evidenceData, file) {
    if (apiClient.backendAvailable) {
      const formData = new FormData();
      formData.append('activityId', activityId);
      formData.append('comments', evidenceData.comments || '');
      if (file) formData.append('file', file);
      return await apiClient.submitActivity(formData);
    }
    return this._submitLocal(activityId, studentUsername, evidenceData);
  }

  _submitLocal(activityId, studentUsername, evidenceData) {
    const submissions = this.getSubmissions();
    const submission = {
      id: Date.now().toString(), activityId, studentUsername,
      evidence: evidenceData, status: 'pending',
      submittedAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null,
      comments: null, tokensAwarded: 0
    };
    submissions.push(submission);
    localStorage.setItem('submissions', JSON.stringify(submissions));
    return submission;
  }

  getSubmissions() {
    try { return JSON.parse(localStorage.getItem('submissions') || '[]'); } catch { return []; }
  }

  getSubmissionsByActivity(activityId) {
    return this.getSubmissions().filter(s => s.activityId === activityId);
  }

  getSubmissionsByStudent(username) {
    return this.getSubmissions().filter(s => s.studentUsername === username);
  }

  async reviewSubmission(submissionId, reviewData) {
    const submissions = this.getSubmissions();
    const index = submissions.findIndex(s => s.id === submissionId);
    if (index === -1) return null;

    const submission = submissions[index];
    const activity = this.getActivityById(submission.activityId);

    submissions[index] = { ...submission, ...reviewData, reviewedAt: new Date().toISOString() };

    if (reviewData.status === 'approved' && activity) {
      const tokensToAward = activity.tokens || 0;
      submissions[index].tokensAwarded = tokensToAward;
    }

    localStorage.setItem('submissions', JSON.stringify(submissions));
    return submissions[index];
  }

  // ========== TOKENS (SOROBAN MINT) ==========

  async awardTokens(username, amount, activityId) {
    const userTokens = this.getUserTokens(username);
    const newBalance = userTokens.balance + amount;

    const transaction = {
      id: Date.now().toString(), username, amount, type: 'earned',
      activityId, timestamp: new Date().toISOString(),
      description: 'Tokens ganados por actividad aprobada',
      blockchainTxHash: null
    };

    let blockchainTxHash = null;

    try {
      const users = this.loadUsers();
      const user = users.find(u => u.username === username);

      if (user && user.stellarPublic) {
        await this.ensureStellarSdk();

        const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const teacherPublicKey = currentUser.stellarPublic;

        if (teacherPublicKey && typeof window.freighterApi !== 'undefined') {
          try {
            const hash = await SorobanContract.mintTokens(user.stellarPublic, amount);
            if (hash) {
              blockchainTxHash = hash;
              transaction.blockchainTxHash = hash;
              transaction.description += ` (Minteado en Soroban: ${hash.substring(0, 8)}...)`;
            }
          } catch (contractError) {
            console.warn('Error llamando contrato Soroban:', contractError);
            transaction.description += ` (Error Soroban: ${contractError.message})`;
          }
        } else {
          try {
            if (typeof stellarIntegration !== 'undefined' && typeof StellarSdk !== 'undefined') {
              const xlmAmount = stellarIntegration.tokensToXLM(amount);
              const result = await stellarIntegration.transferTokens(user.stellarPublic, xlmAmount,
                `Tokens por actividad ${activityId}`);
              if (result.success) {
                blockchainTxHash = result.hash;
                transaction.blockchainTxHash = result.hash;
                transaction.description += ` (XLM transferido: ${result.hash.substring(0, 8)}...)`;
              }
            }
          } catch (stellarError) {
            console.warn('Error en transferencia Stellar:', stellarError);
            transaction.description += ` (Error transferencia: ${stellarError.message})`;
          }
        }
      } else {
        console.warn(`${username} no tiene wallet Stellar`);
        transaction.description += ` (Wallet no configurada)`;
      }
    } catch (error) {
      console.warn('Error en awardTokens:', error);
      transaction.description += ` (Error: ${error.message})`;
    }

    userTokens.balance = newBalance;
    userTokens.transactions.push(transaction);
    localStorage.setItem(`tokens_${username}`, JSON.stringify(userTokens));

    const allTransactions = this.getAllTokenTransactions();
    allTransactions.push(transaction);
    localStorage.setItem('token_transactions', JSON.stringify(allTransactions));

    return blockchainTxHash;
  }

  async ensureStellarSdk() {
    const promises = [];
    if (typeof StellarSdk === 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/stellar-sdk/11.2.2/stellar-sdk.min.js';
      document.head.appendChild(script);
      promises.push(new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
      }));
    }
    if (typeof SorobanContract === 'undefined') {
      const s2 = document.createElement('script');
      s2.src = 'js/stellar-integration.js';
      document.head.appendChild(s2);
      promises.push(new Promise((resolve, reject) => {
        s2.onload = resolve;
        s2.onerror = reject;
      }));
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  getUserTokens(username) {
    try {
      const stored = localStorage.getItem(`tokens_${username}`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return { balance: 0, transactions: [] };
  }

  getAllTokenTransactions() {
    try { return JSON.parse(localStorage.getItem('token_transactions') || '[]'); } catch { return []; }
  }

  // ========== RECOMPENSAS ==========

  createReward(rewardData) {
    const rewards = this.getRewards();
    const reward = { id: Date.now().toString(), ...rewardData, createdAt: new Date().toISOString(), status: 'active', redeemedCount: 0 };
    rewards.push(reward);
    localStorage.setItem('rewards', JSON.stringify(rewards));
    return reward;
  }

  getRewards() {
    try { return JSON.parse(localStorage.getItem('rewards') || '[]'); } catch { return []; }
  }

  getRedemptions() {
    try { return JSON.parse(localStorage.getItem('redemptions') || '[]'); } catch { return []; }
  }

  redeemReward(username, rewardId) {
    const rewards = this.getRewards();
    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return { success: false, message: 'Recompensa no encontrada' };

    const userTokens = this.getUserTokens(username);
    if (userTokens.balance < reward.cost) return { success: false, message: 'Tokens insuficientes' };

    userTokens.balance -= reward.cost;
    const transaction = {
      id: Date.now().toString(), username, amount: -reward.cost, type: 'redeemed',
      rewardId, timestamp: new Date().toISOString(), description: `Canjeado: ${reward.name}`
    };
    userTokens.transactions.push(transaction);
    localStorage.setItem(`tokens_${username}`, JSON.stringify(userTokens));

    const redemptions = this.getRedemptions();
    redemptions.push({
      id: Date.now().toString(), username, rewardId, rewardName: reward.name,
      cost: reward.cost, timestamp: new Date().toISOString()
    });
    localStorage.setItem('redemptions', JSON.stringify(redemptions));

    return { success: true, newBalance: userTokens.balance };
  }

  // ========== ESTADÍSTICAS ==========

  getStudentStats(username) {
    const submissions = this.getSubmissionsByStudent(username);
    const userTokens = this.getUserTokens(username);
    const activities = this.getActivities().filter(a => a.status === 'active');

    return {
      totalActivities: activities.length,
      pendingSubmissions: submissions.filter(s => s.status === 'pending').length,
      pendingReview: submissions.filter(s => s.status === 'pending').length,
      needsCorrection: submissions.filter(s => s.status === 'needs_correction').length,
      approved: submissions.filter(s => s.status === 'approved').length,
      rejected: submissions.filter(s => s.status === 'rejected').length,
      tokensBalance: userTokens.balance,
      tokensEarned: submissions.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.tokensAwarded || 0), 0),
      activitiesCompleted: submissions.filter(s => s.status === 'approved').length
    };
  }

  getTeacherStats(teacherUsername) {
    const activities = this.getActivities().filter(a => a.createdBy === teacherUsername);
    const allSubmissions = this.getSubmissions();
    const teacherSubmissions = allSubmissions.filter(s => {
      const activity = this.getActivityById(s.activityId);
      return activity && activity.createdBy === teacherUsername;
    });

    return {
      totalActivities: activities.length,
      pendingReviews: teacherSubmissions.filter(s => s.status === 'pending').length,
      totalTokensAwarded: teacherSubmissions.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.tokensAwarded || 0), 0),
      totalStudents: new Set(teacherSubmissions.map(s => s.studentUsername)).size
    };
  }
}

const activitiesSystem = new ActivitiesSystem();
