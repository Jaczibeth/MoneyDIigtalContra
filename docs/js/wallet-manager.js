/**
 * Wallet Manager - Gestión centralizada de conexión Stellar
 * Soporta Freighter Wallet y claves manuales
 */

class WalletManager {
    constructor() {
        this.publicKey = null;
        this.secretKey = null;
        this.usingFreighter = false;
        this.networkPassphrase = StellarSdk.Networks.TESTNET;
        this.server = new StellarSdk.Server('https://horizon-testnet.stellar.org');
        
        // Claves por defecto del usuario (si se proporcionan)
        this.defaultSecretKey = 'SD4ZN2WZKRGHJXKOA4TZ3LDW4JY43LT6RU4YSD6PVJ7IRMLDW4EPOPET';
        this.defaultPublicKey = 'GAX6QLY4HV23XBE3E7WBMUXKJ3Y7BS6CWF6JBE7U5TEOFEK5P6H2QYYD';
    }

    /**
     * Verifica si Freighter está disponible
     */
    isFreighterAvailable() {
        return typeof window.freighterApi !== 'undefined';
    }

    /**
     * Conecta con Freighter Wallet
     */
    async connectWithFreighter() {
        if (!this.isFreighterAvailable()) {
            throw new Error('Freighter Wallet no está instalado. Descárgalo desde https://freighter.app/');
        }

        try {
            // Verificar permisos
            let isAllowed = false;
            try {
                isAllowed = await window.freighterApi.isAllowed();
            } catch (e) {
                // Si isAllowed no está disponible, intentar conectar directamente
                if (typeof window.freighterApi.connect === 'function') {
                    await window.freighterApi.connect();
                    isAllowed = true;
                }
            }

            if (!isAllowed) {
                await window.freighterApi.setAllowed();
            }

            // Obtener clave pública
            this.publicKey = await window.freighterApi.getPublicKey();
            this.usingFreighter = true;
            this.secretKey = null; // No almacenamos secret key con Freighter

            // Guardar en localStorage
            this.saveToStorage();

            return {
                success: true,
                publicKey: this.publicKey,
                method: 'freighter'
            };
        } catch (error) {
            console.error('Error conectando Freighter:', error);
            throw new Error(`Error conectando Freighter: ${error.message}`);
        }
    }

    /**
     * Conecta con clave secreta manual
     */
    async connectWithSecretKey(secretKey) {
        try {
            const keypair = StellarSdk.Keypair.fromSecret(secretKey);
            this.publicKey = keypair.publicKey();
            this.secretKey = secretKey;
            this.usingFreighter = false;

            // Guardar en localStorage (cifrado)
            this.saveToStorage();

            return {
                success: true,
                publicKey: this.publicKey,
                method: 'manual'
            };
        } catch (error) {
            throw new Error('Clave secreta inválida. Debe comenzar con "S" y tener 56 caracteres.');
        }
    }

    /**
     * Conecta usando las claves por defecto del usuario
     */
    async connectWithDefaultKeys() {
        return await this.connectWithSecretKey(this.defaultSecretKey);
    }

    /**
     * Carga la wallet desde localStorage
     */
    loadFromStorage() {
        try {
            const stored = localStorage.getItem('walletConnection');
            if (stored) {
                const data = JSON.parse(stored);
                this.publicKey = data.publicKey;
                this.usingFreighter = data.usingFreighter || false;
                // No cargamos secretKey desde storage por seguridad
                return true;
            }
        } catch (e) {
            console.warn('Error cargando wallet desde storage:', e);
        }
        return false;
    }

    /**
     * Guarda la conexión en localStorage
     */
    saveToStorage() {
        try {
            const data = {
                publicKey: this.publicKey,
                usingFreighter: this.usingFreighter,
                timestamp: Date.now()
            };
            localStorage.setItem('walletConnection', JSON.stringify(data));
            
            // También actualizar currentUser si existe
            const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
            if (currentUser && this.publicKey) {
                currentUser.stellarPublic = this.publicKey;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
            }
        } catch (e) {
            console.warn('Error guardando wallet en storage:', e);
        }
    }

    /**
     * Obtiene el balance de la cuenta
     */
    async getBalance(publicKey = null) {
        const pk = publicKey || this.publicKey;
        if (!pk) {
            throw new Error('No hay wallet conectada');
        }

        try {
            const account = await this.server.loadAccount(pk);
            const balance = account.balances.find(b => b.asset_type === 'native');
            return {
                xlm: balance ? parseFloat(balance.balance) : 0,
                formatted: balance ? `${balance.balance} XLM` : '0 XLM'
            };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return {
                    xlm: 0,
                    formatted: 'Cuenta no encontrada. Financia tu cuenta con friendbot.',
                    needsFunding: true
                };
            }
            throw error;
        }
    }

    /**
     * Financia la cuenta usando friendbot (solo Testnet)
     */
    async fundAccount(publicKey = null) {
        const pk = publicKey || this.publicKey;
        if (!pk) {
            throw new Error('No hay wallet conectada');
        }

        try {
            const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pk)}`);
            const json = await response.json();
            
            // Esperar un momento para que la transacción se procese
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return {
                success: true,
                response: json
            };
        } catch (error) {
            throw new Error(`Error financiando cuenta: ${error.message}`);
        }
    }

    /**
     * Envía XLM a otra cuenta
     */
    async sendPayment(destination, amount, memo = '') {
        if (!this.publicKey) {
            throw new Error('No hay wallet conectada');
        }

        if (!StellarSdk.StrKey.isValidEd25519PublicKey(destination)) {
            throw new Error('Cuenta destino inválida');
        }

        if (Number(amount) <= 0) {
            throw new Error('Cantidad inválida');
        }

        try {
            const account = await this.server.loadAccount(this.publicKey);
            const fee = await this.server.fetchBaseFee();

            const tx = new StellarSdk.TransactionBuilder(account, {
                fee,
                networkPassphrase: this.networkPassphrase
            })
            .addOperation(StellarSdk.Operation.payment({
                destination: destination,
                asset: StellarSdk.Asset.native(),
                amount: amount.toString()
            }))
            .setTimeout(30)
            .build();

            // Firmar según el método
            let signedTx;
            if (this.usingFreighter && this.isFreighterAvailable()) {
                const signedXdr = await window.freighterApi.signTransaction(tx.toXDR(), {
                    network: this.networkPassphrase,
                    accountToSign: this.publicKey
                });
                signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
            } else if (this.secretKey) {
                const keypair = StellarSdk.Keypair.fromSecret(this.secretKey);
                tx.sign(keypair);
                signedTx = tx;
            } else {
                throw new Error('No se puede firmar la transacción. Conecta tu wallet primero.');
            }

            const result = await this.server.submitTransaction(signedTx);
            return {
                success: true,
                hash: result.hash,
                result: result
            };
        } catch (error) {
            throw new Error(`Error en transacción: ${error.message}`);
        }
    }

    /**
     * Desconecta la wallet
     */
    disconnect() {
        this.publicKey = null;
        this.secretKey = null;
        this.usingFreighter = false;
        localStorage.removeItem('walletConnection');
    }

    /**
     * Verifica si hay una wallet conectada
     */
    isConnected() {
        return !!this.publicKey;
    }

    /**
     * Obtiene la clave pública actual
     */
    getPublicKey() {
        return this.publicKey;
    }
}

// Crear instancia global
window.walletManager = new WalletManager();

// Cargar desde storage al inicializar
if (typeof StellarSdk !== 'undefined') {
    window.walletManager.loadFromStorage();
}

