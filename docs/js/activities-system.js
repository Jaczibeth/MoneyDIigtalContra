// Sistema de Actividades y Tokens - Money Digital
// Este archivo maneja toda la lógica de actividades, evidencias y tokens

class ActivitiesSystem {
    constructor() {
        this.init();
    }

    init() {
        // Inicializar estructuras de datos si no existen
        if (!localStorage.getItem('activities')) {
            localStorage.setItem('activities', JSON.stringify([]));
        }
        if (!localStorage.getItem('submissions')) {
            localStorage.setItem('submissions', JSON.stringify([]));
        }
        if (!localStorage.getItem('rewards')) {
            localStorage.setItem('rewards', JSON.stringify([]));
        }
        if (!localStorage.getItem('redemptions')) {
            localStorage.setItem('redemptions', JSON.stringify([]));
        }
    }

    // ========== ACTIVIDADES ==========

    createActivity(activityData) {
        const activities = this.getActivities();
        const newActivity = {
            id: Date.now().toString(),
            ...activityData,
            createdAt: new Date().toISOString(),
            status: 'active',
            submissions: []
        };
        activities.push(newActivity);
        localStorage.setItem('activities', JSON.stringify(activities));
        return newActivity;
    }

    getActivities() {
        try {
            return JSON.parse(localStorage.getItem('activities') || '[]');
        } catch (e) {
            return [];
        }
    }

    getActivityById(id) {
        const activities = this.getActivities();
        return activities.find(a => a.id === id);
    }

    updateActivity(id, updates) {
        const activities = this.getActivities();
        const index = activities.findIndex(a => a.id === id);
        if (index !== -1) {
            activities[index] = { ...activities[index], ...updates };
            localStorage.setItem('activities', JSON.stringify(activities));
            return activities[index];
        }
        return null;
    }

    deleteActivity(id) {
        const activities = this.getActivities();
        const filtered = activities.filter(a => a.id !== id);
        localStorage.setItem('activities', JSON.stringify(filtered));
        return true;
    }

    // ========== SUBMISIONES (EVIDENCIAS) ==========

    submitActivity(activityId, studentUsername, evidenceData) {
        const submissions = this.getSubmissions();
        const newSubmission = {
            id: Date.now().toString(),
            activityId: activityId,
            studentUsername: studentUsername,
            evidence: evidenceData,
            status: 'pending', // pending, approved, rejected, needs_correction
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            reviewedBy: null,
            comments: null,
            tokensAwarded: 0
        };
        submissions.push(newSubmission);
        localStorage.setItem('submissions', JSON.stringify(submissions));
        return newSubmission;
    }

    getSubmissions() {
        try {
            return JSON.parse(localStorage.getItem('submissions') || '[]');
        } catch (e) {
            return [];
        }
    }

    getSubmissionById(id) {
        const submissions = this.getSubmissions();
        return submissions.find(s => s.id === id);
    }

    getSubmissionsByActivity(activityId) {
        const submissions = this.getSubmissions();
        return submissions.filter(s => s.activityId === activityId);
    }

    getSubmissionsByStudent(username) {
        const submissions = this.getSubmissions();
        return submissions.filter(s => s.studentUsername === username);
    }

    async reviewSubmission(submissionId, reviewData) {
        const submissions = this.getSubmissions();
        const index = submissions.findIndex(s => s.id === submissionId);
        if (index !== -1) {
            const submission = submissions[index];
            const activity = this.getActivityById(submission.activityId);

            submissions[index] = {
                ...submission,
                ...reviewData,
                reviewedAt: new Date().toISOString()
            };

            // Si se aprueba, otorgar tokens automáticamente
            if (reviewData.status === 'approved' && activity) {
                const tokensToAward = activity.tokens || 0;
                submissions[index].tokensAwarded = tokensToAward;

                // Actualizar tokens del estudiante (async)
                try {
                    await this.awardTokens(submission.studentUsername, tokensToAward, activity.id);
                    console.log(`✓ ${tokensToAward} tokens otorgados a ${submission.studentUsername}`);
                } catch (err) {
                    console.error('Error otorgando tokens:', err);
                    // Continuar de todas formas
                }
            }

            localStorage.setItem('submissions', JSON.stringify(submissions));
            return submissions[index];
        }
        return null;
    }

    // ========== TOKENS ==========

    async awardTokens(username, amount, activityId) {
        const userTokens = this.getUserTokens(username);
        const newBalance = userTokens.balance + amount;

        const transaction = {
            id: Date.now().toString(),
            username: username,
            amount: amount,
            type: 'earned',
            activityId: activityId,
            timestamp: new Date().toISOString(),
            description: `Tokens ganados por actividad aprobada`,
            stellarHash: null // Se llenará si la transferencia es exitosa
        };

        // Intentar transferir tokens a la wallet Stellar del estudiante
        try {
            const users = this.loadUsers();
            const user = users.find(u => u.username === username);

            // Verificar que el estudiante tenga wallet conectada
            if (user && user.stellarPublic) {
                // Cargar Stellar SDK si no está cargado
                if (typeof StellarSdk === 'undefined') {
                    const stellarScript = document.createElement('script');
                    stellarScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/stellar-sdk/11.2.2/stellar-sdk.min.js';
                    document.head.appendChild(stellarScript);
                    await new Promise((resolve, reject) => {
                        stellarScript.onload = resolve;
                        stellarScript.onerror = reject;
                        setTimeout(resolve, 3000); // Timeout de seguridad
                    });
                }

                // Cargar script de integración Stellar si no está cargado
                if (typeof stellarIntegration === 'undefined') {
                    const script = document.createElement('script');
                    script.src = 'js/stellar-integration.js';
                    document.head.appendChild(script);
                    await new Promise(resolve => {
                        script.onload = resolve;
                        setTimeout(resolve, 1000);
                    });
                }

                // Convertir tokens a XLM y transferir desde la wallet del sistema
                // Nota: En producción, esto debería venir de una wallet del sistema, no del docente
                if (typeof stellarIntegration !== 'undefined' && typeof StellarSdk !== 'undefined') {
                    try {
                        // Obtener la wallet del usuario actual (docente que aprueba) o usar una wallet del sistema
                        const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
                        const senderPublicKey = currentUser.stellarPublic || null;

                        if (senderPublicKey) {
                            const xlmAmount = stellarIntegration.tokensToXLM(amount);
                            const result = await stellarIntegration.transferTokens(
                                user.stellarPublic,
                                xlmAmount,
                                `Tokens por actividad ${activityId}`
                            );
                            if (result.success) {
                                transaction.stellarHash = result.hash;
                                transaction.description += ` (Transferido a wallet Stellar: ${result.hash.substring(0, 8)}...)`;
                                console.log(`✓ ${amount} tokens transferidos a wallet Stellar del estudiante ${username}`);
                            } else {
                                console.warn('No se pudo transferir a wallet Stellar:', result.error);
                                transaction.description += ` (Transferencia Stellar fallida: ${result.error})`;
                            }
                        } else {
                            console.warn('No hay wallet conectada para transferir tokens. Los tokens se guardan solo localmente.');
                            transaction.description += ` (Wallet no conectada - tokens guardados localmente)`;
                        }
                    } catch (stellarError) {
                        console.warn('Error en transferencia Stellar:', stellarError);
                        transaction.description += ` (Error en transferencia: ${stellarError.message})`;
                        // Continuar de todas formas, los tokens se guardan localmente
                    }
                } else {
                    console.warn('Stellar SDK o integración no disponible. Los tokens se guardan solo localmente.');
                    transaction.description += ` (Stellar SDK no disponible - tokens guardados localmente)`;
                }
            } else {
                console.warn(`El estudiante ${username} no tiene wallet Stellar conectada. Los tokens se guardan solo localmente.`);
                transaction.description += ` (Wallet del estudiante no conectada - tokens guardados localmente)`;
            }
        } catch (error) {
            console.warn('No se pudo transferir tokens a wallet Stellar:', error);
            transaction.description += ` (Error: ${error.message})`;
            // Continuar de todas formas, los tokens se guardan localmente
        }

        userTokens.balance = newBalance;
        userTokens.transactions.push(transaction);

        localStorage.setItem(`tokens_${username}`, JSON.stringify(userTokens));

        // También guardar en el historial global
        const allTransactions = this.getAllTokenTransactions();
        allTransactions.push(transaction);
        localStorage.setItem('token_transactions', JSON.stringify(allTransactions));

        return userTokens;
    }

    loadUsers() {
        try {
            return JSON.parse(localStorage.getItem('users') || '[]');
        } catch (e) {
            return [];
        }
    }

    getUserTokens(username) {
        try {
            const stored = localStorage.getItem(`tokens_${username}`);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) { }

        return {
            balance: 0,
            transactions: []
        };
    }

    getAllTokenTransactions() {
        try {
            return JSON.parse(localStorage.getItem('token_transactions') || '[]');
        } catch (e) {
            return [];
        }
    }

    redeemReward(username, rewardId) {
        const rewards = this.getRewards();
        const reward = rewards.find(r => r.id === rewardId);
        if (!reward) return null;

        const userTokens = this.getUserTokens(username);
        if (userTokens.balance < reward.cost) {
            return { success: false, message: 'Tokens insuficientes' };
        }

        // Descontar tokens
        userTokens.balance -= reward.cost;
        const transaction = {
            id: Date.now().toString(),
            username: username,
            amount: -reward.cost,
            type: 'redeemed',
            rewardId: rewardId,
            timestamp: new Date().toISOString(),
            description: `Canjeado: ${reward.name}`
        };
        userTokens.transactions.push(transaction);
        localStorage.setItem(`tokens_${username}`, JSON.stringify(userTokens));

        // Registrar canje
        const redemptions = this.getRedemptions();
        redemptions.push({
            id: Date.now().toString(),
            username: username,
            rewardId: rewardId,
            rewardName: reward.name,
            cost: reward.cost,
            timestamp: new Date().toISOString()
        });
        localStorage.setItem('redemptions', JSON.stringify(redemptions));

        return { success: true, newBalance: userTokens.balance };
    }

    // ========== RECOMPENSAS ==========

    createReward(rewardData) {
        const rewards = this.getRewards();
        const newReward = {
            id: Date.now().toString(),
            ...rewardData,
            createdAt: new Date().toISOString(),
            status: 'active',
            redeemedCount: 0
        };
        rewards.push(newReward);
        localStorage.setItem('rewards', JSON.stringify(rewards));
        return newReward;
    }

    getRewards() {
        try {
            return JSON.parse(localStorage.getItem('rewards') || '[]');
        } catch (e) {
            return [];
        }
    }

    getRedemptions() {
        try {
            return JSON.parse(localStorage.getItem('redemptions') || '[]');
        } catch (e) {
            return [];
        }
    }

    // ========== ESTADÍSTICAS ==========

    getStudentStats(username) {
        const submissions = this.getSubmissionsByStudent(username);
        const userTokens = this.getUserTokens(username);
        const activities = this.getActivities();

        return {
            totalActivities: activities.length,
            pendingSubmissions: submissions.filter(s => s.status === 'pending').length,
            pendingReview: submissions.filter(s => s.status === 'pending').length,
            needsCorrection: submissions.filter(s => s.status === 'needs_correction').length,
            approved: submissions.filter(s => s.status === 'approved').length,
            rejected: submissions.filter(s => s.status === 'rejected').length,
            tokensBalance: userTokens.balance,
            tokensEarned: submissions
                .filter(s => s.status === 'approved')
                .reduce((sum, s) => sum + (s.tokensAwarded || 0), 0),
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
            approvedToday: teacherSubmissions.filter(s => {
                if (s.status !== 'approved') return false;
                const today = new Date().toDateString();
                return new Date(s.reviewedAt).toDateString() === today;
            }).length,
            totalTokensAwarded: teacherSubmissions
                .filter(s => s.status === 'approved')
                .reduce((sum, s) => sum + (s.tokensAwarded || 0), 0),
            totalStudents: new Set(teacherSubmissions.map(s => s.studentUsername)).size
        };
    }
}

// Instancia global
const activitiesSystem = new ActivitiesSystem();


