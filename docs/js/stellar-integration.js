const CONTRACT_ID = 'CDS3VGIAZFIZUG3GL6LWAXLOXWCRIIBDPPRS4225LLLEHPGTFDNF4PQK';
const RPC_URL = 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL = 'https://rpc-testnet.stellar.org';

class StellarIntegration {
  constructor() {
    this.RPC_URL = RPC_URL;
    this.SOROBAN_RPC_URL = SOROBAN_RPC_URL;
    this.networkPassphrase = 'Test SDF Network ; September 2015';
  }

  isFreighterAvailable() {
    return typeof window.freighterApi !== 'undefined';
  }

  async getUserPublicKey() {
    if (this.isFreighterAvailable()) {
      try {
        const isAllowed = await window.freighterApi.isAllowed();
        if (!isAllowed) await window.freighterApi.setAllowed();
        return await window.freighterApi.getPublicKey();
      } catch (e) {
        console.warn('No se pudo obtener clave de Freighter:', e);
      }
    }
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    return currentUser.stellarPublic || null;
  }

  async transferXLM(recipientPublicKey, amount, memo = '') {
    try {
      if (typeof StellarSdk === 'undefined') throw new Error('Stellar SDK no cargado');

      const senderPublicKey = await this.getUserPublicKey();
      if (!senderPublicKey) throw new Error('No hay wallet conectada');

      const server = new StellarSdk.Server(this.RPC_URL);
      const senderAccount = await server.loadAccount(senderPublicKey);

      const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
        fee: StellarSdk.BASE_FEE, networkPassphrase: StellarSdk.Networks.TESTNET
      })
      .addOperation(StellarSdk.Operation.payment({
        destination: recipientPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: amount.toString()
      }))
      .addMemo(StellarSdk.Memo.text(memo || 'Tokens por actividad'))
      .setTimeout(30).build();

      if (this.isFreighterAvailable()) {
        const signedXdr = await window.freighterApi.signTransaction(transaction.toXDR(), {
          network: StellarSdk.Networks.TESTNET, accountToSign: senderPublicKey
        });
        const txFromXdr = StellarSdk.TransactionBuilder.fromXDR(signedXdr, StellarSdk.Networks.TESTNET);
        const result = await server.submitTransaction(txFromXdr);
        return { success: true, hash: result.hash };
      } else {
        const stellarSecret = localStorage.getItem('stellarSecret');
        if (!stellarSecret) throw new Error('No se puede firmar. Conecta Freighter.');
        const keypair = StellarSdk.Keypair.fromSecret(stellarSecret);
        transaction.sign(keypair);
        const result = await server.submitTransaction(transaction);
        return { success: true, hash: result.hash };
      }
    } catch (error) {
      console.error('Error en transferencia:', error);
      return { success: false, error: error.message };
    }
  }

  async getStellarBalance(publicKey) {
    try {
      const server = new StellarSdk.Server(this.RPC_URL);
      const account = await server.loadAccount(publicKey);
      const balance = account.balances.find(b => b.asset_type === 'native');
      return balance ? parseFloat(balance.balance) : 0;
    } catch { return 0; }
  }

  tokensToXLM(tokens) {
    return (tokens * 0.1).toFixed(7);
  }
}

class SorobanContract {
  static async mintTokens(studentPublicKey, amount) {
    try {
      if (typeof StellarSdk === 'undefined') throw new Error('Stellar SDK no cargado');
      if (typeof window.freighterApi === 'undefined') throw new Error('Freighter no disponible');

      const publicKey = await window.freighterApi.getPublicKey();
      const server = new StellarSdk.Server(RPC_URL);

      let account;
      try {
        account = await server.loadAccount(publicKey);
      } catch (err) {
        const notFound = err && (err.status === 404 || (err.response && err.response.status === 404));
        if (notFound) {
          const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
          await res.json();
          await new Promise(r => setTimeout(r, 2000));
          account = await server.loadAccount(publicKey);
        } else {
          throw err;
        }
      }

      const amountI128 = SorobanContract.toScvI128(amount);
      const networkPassphrase = StellarSdk.Networks.TESTNET;

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE, networkPassphrase
      });

      const contractAddress = StellarSdk.StrKey.encodeContract(CONTRACT_ID);
      const adminAddress = SorobanContract.toScvAddress(publicKey);
      const studentAddress = SorobanContract.toScvAddress(studentPublicKey);

      const args = [adminAddress, studentAddress, amountI128];

      const contractOp = StellarSdk.Operation.invokeHostFunction({
        hostFunction: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
          new StellarSdk.xdr.InvokeContractArgs({
            contractAddress: contractAddress,
            functionName: 'mint',
            args: args
          })
        ),
        source: publicKey,
      });

      txBuilder.addOperation(contractOp);
      const transaction = txBuilder.setTimeout(30).build();

      const signedXdr = await window.freighterApi.signTransaction(transaction.toXDR(), {
        network: networkPassphrase, accountToSign: publicKey
      });

      const txFromXDR = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      const result = await server.submitTransaction(txFromXDR);

      const txHash = result.hash;
      console.log(`mint() ejecutado en Soroban. Hash: ${txHash}`);

      try {
        const txs = JSON.parse(localStorage.getItem('blockchain_txs') || '[]');
        txs.push({
          type: 'mint', studentPublicKey, amount, txHash,
          timestamp: new Date().toISOString(), contractId: CONTRACT_ID
        });
        localStorage.setItem('blockchain_txs', JSON.stringify(txs));
      } catch (e) {}

      return txHash;
    } catch (error) {
      console.error('Error en mint() del contrato Soroban:', error);
      throw error;
    }
  }

  static async getContractBalance(walletAddress) {
    try {
      if (typeof StellarSdk === 'undefined') return null;

      const publicKey = await window.freighterApi.getPublicKey();
      const server = new StellarSdk.Server(RPC_URL);
      const account = await server.loadAccount(publicKey);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE, networkPassphrase: StellarSdk.Networks.TESTNET
      });

      const args = [SorobanContract.toScvAddress(walletAddress)];
      const contractAddress = StellarSdk.StrKey.encodeContract(CONTRACT_ID);

      const contractOp = StellarSdk.Operation.invokeHostFunction({
        hostFunction: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
          new StellarSdk.xdr.InvokeContractArgs({
            contractAddress: contractAddress,
            functionName: 'get_balance',
            args: args
          })
        ),
        source: publicKey,
      });

      txBuilder.addOperation(contractOp);
      const transaction = txBuilder.setTimeout(30).build();

      const signedXdr = await window.freighterApi.signTransaction(transaction.toXDR(), {
        network: StellarSdk.Networks.TESTNET, accountToSign: publicKey
      });

      const txFromXDR = StellarSdk.TransactionBuilder.fromXDR(signedXdr, StellarSdk.Networks.TESTNET);
      const result = await server.submitTransaction(txFromXDR);
      return result;
    } catch (error) {
      console.error('Error consultando balance del contrato:', error);
      return null;
    }
  }

  static async registerWalletOnChain() {
    if (typeof StellarSdk === 'undefined') throw new Error('Stellar SDK no cargado');
    if (typeof window.freighterApi === 'undefined') throw new Error('Freighter no disponible');

    const publicKey = await window.freighterApi.getPublicKey();
    const server = new StellarSdk.Server(RPC_URL);
    let account;

    try {
      account = await server.loadAccount(publicKey);
    } catch (err) {
      const notFound = err && (err.status === 404 || (err.response && err.response.status === 404));
      if (notFound) {
        const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
        await res.json();
        await new Promise(r => setTimeout(r, 2000));
        account = await server.loadAccount(publicKey);
      } else {
        throw err;
      }
    }

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE, networkPassphrase: StellarSdk.Networks.TESTNET
    });

    const args = [SorobanContract.toScvAddress(publicKey)];

    const contractOp = StellarSdk.Operation.invokeHostFunction({
      hostFunction: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
        new StellarSdk.xdr.InvokeContractArgs({
          contractAddress: StellarSdk.StrKey.encodeContract(CONTRACT_ID),
          functionName: 'register_wallet',
          args: args
        })
      ),
      source: publicKey,
    });

    txBuilder.addOperation(contractOp);
    const transaction = txBuilder.setTimeout(30).build();

    const signedXdr = await window.freighterApi.signTransaction(transaction.toXDR(), {
      network: StellarSdk.Networks.TESTNET, accountToSign: publicKey
    });

    const txFromXDR = StellarSdk.TransactionBuilder.fromXDR(signedXdr, StellarSdk.Networks.TESTNET);
    const result = await server.submitTransaction(txFromXDR);
    return result.hash;
  }

  static toScvAddress(pubKey) {
    const keypair = StellarSdk.Keypair.fromPublicKey(pubKey);
    return StellarSdk.xdr.ScVal.scvAddress(keypair.xdrAccountId());
  }

  static toScvI128(value) {
    const num = BigInt(Math.floor(Number(value)));
    const hi = Number(num >> 64n);
    const lo = Number(num & 0xFFFFFFFFFFFFFFFFn);
    const bits = new StellarSdk.xdr.Int128Parts({
      lo: new StellarSdk.xdr.Uint64(lo),
      hi: new StellarSdk.xdr.Int64(hi)
    });
    return StellarSdk.xdr.ScVal.scvI128(bits);
  }
}

const stellarIntegration = new StellarIntegration();
