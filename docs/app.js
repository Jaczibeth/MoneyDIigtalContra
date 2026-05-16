const CONTRACT_ID = "CDS3VGIAZFIZUG3GL6LWAXLOXWCRIIBDPPRS4225LLLEHPGTFDNF4PQK";

const RPC_URL = 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL = 'https://rpc-testnet.stellar.org';

let connectedWallet = null;
let publicKey = null;
let networkPassphrase = StellarSdk.Networks.TESTNET;

const form = document.getElementById('userForm');
const nameEl = document.getElementById('name');
const emailEl = document.getElementById('email');
const passwordEl = document.getElementById('password');
const result = document.getElementById('result');
const clavePublicaManualInput = document.getElementById('clavePublicaManual');

function isFreighterAvailable() {
  return typeof window.freighterApi !== 'undefined';
}

async function connectFreighterWallet() {
  if (!isFreighterAvailable()) {
    alert('Freighter wallet no está instalado. Por favor, instálalo desde https://freighter.app/');
    return false;
  }

  try {
    const isAllowed = await window.freighterApi.isAllowed();
    if (!isAllowed) {
      await window.freighterApi.setAllowed();
    }
    publicKey = await window.freighterApi.getPublicKey();
    connectedWallet = publicKey;
    console.log('Wallet conectada:', publicKey);
    updateWalletStatus(true);
    return true;
  } catch (error) {
    console.error('Error conectando con Freighter:', error);
    result.textContent = `Error conectando wallet: ${error.message}`;
    return false;
  }
}

function updateWalletStatus(connected) {
  const walletBtn = document.getElementById('connectWalletBtn');
  const walletStatus = document.getElementById('walletStatus');

  if (connected && connectedWallet) {
    if (walletBtn) {
      walletBtn.textContent = 'Wallet Conectada';
      walletBtn.classList.add('bg-green-500', 'text-white');
      walletBtn.disabled = true;
    }
    if (walletStatus) {
      walletStatus.textContent = `Conectado: ${publicKey.substring(0, 10)}...${publicKey.substring(publicKey.length - 10)}`;
      walletStatus.classList.remove('hidden');
    }
  }
}

async function signTransactionWithFreighter(transaction) {
  if (!connectedWallet) {
    throw new Error('Wallet no conectada');
  }
  try {
    const signedTransaction = await window.freighterApi.signTransaction(transaction, {
      network: networkPassphrase,
      accountToSign: publicKey,
    });
    return signedTransaction;
  } catch (error) {
    console.error('Error firmando transacción:', error);
    throw error;
  }
}

async function ejecutarAccion(accion, params = {}) {
  if (!connectedWallet) {
    alert('Por favor, conecta tu wallet Freighter primero');
    return;
  }

  result.textContent = `Ejecutando: ${accion}...`;

  try {
    const server = new StellarSdk.Server(RPC_URL);

    let account;
    try {
      account = await server.loadAccount(publicKey);
    } catch (err) {
      const notFound = (err && (err.status === 404 || (err.response && err.response.status === 404))) || (err && err.message && err.message.toLowerCase().includes('resource missing'));
      if (notFound) {
        const wantFund = confirm('La cuenta no existe en Testnet. Deseas financiarla con friendbot?');
        if (wantFund) {
          const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
          await res.json();
          await new Promise(r => setTimeout(r, 1000));
          account = await server.loadAccount(publicKey);
        } else {
          throw new Error('Cuenta no activa en Testnet. Operacion cancelada.');
        }
      } else {
        throw err;
      }
    }

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: networkPassphrase,
    });

    let args = [];
    switch (accion) {
      case 'register_wallet':
        args = [
          scvAddress(params.wallet_address || publicKey)
        ];
        break;
      case 'get_balance':
        args = [
          scvAddress(params.wallet_address || publicKey)
        ];
        break;
      case 'transfer':
        args = [
          scvAddress(params.from || publicKey),
          scvAddress(params.to),
          scvI128(params.amount || 0)
        ];
        break;
      case 'mint':
        args = [
          scvAddress(publicKey),
          scvAddress(params.wallet_address),
          scvI128(params.amount || 0)
        ];
        break;
      case 'burn':
        args = [
          scvAddress(publicKey),
          scvAddress(params.wallet_address),
          scvI128(params.amount || 0)
        ];
        break;
      default:
        throw new Error(`Accion desconocida: ${accion}`);
    }

    const contractOperation = StellarSdk.Operation.invokeHostFunction({
      hostFunction: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
        new StellarSdk.xdr.InvokeContractArgs({
          contractAddress: StellarSdk.StrKey.encodeContract(CONTRACT_ID),
          functionName: accion,
          args: args
        })
      ),
      source: publicKey,
    });

    transaction.addOperation(contractOperation);
    const builtTransaction = transaction.setTimeout(30).build();

    const signedXdr = await signTransactionWithFreighter(builtTransaction.toXDR());
    const transactionFromXDR = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    const response = await server.submitTransaction(transactionFromXDR);

    result.textContent = `Transaccion exitosa! Hash: ${response.hash}`;

  } catch (error) {
    console.error('Error ejecutando accion:', error);
    if (error.message.includes('User declined access')) {
      result.textContent = 'Usuario cancelo la transaccion en Freighter';
    } else if (error.message.includes('Wallet not connected')) {
      result.textContent = 'Wallet no conectada';
    } else {
      result.textContent = `Error: ${error.message}`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!isFreighterAvailable()) {
    result.textContent = 'Freighter wallet no detectada. Instalala desde https://freighter.app/';
  }

  const connectBtn = document.getElementById('connectWalletBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', connectFreighterWallet);
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!connectedWallet) {
        const connected = await connectFreighterWallet();
        if (!connected) return;
      }
      ejecutarAccion('register_wallet', {
        wallet_address: publicKey
      });
    });
  }

  const editBtn = document.getElementById('editBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const getBtn = document.getElementById('getBtn');

  if (editBtn) editBtn.onclick = () => {
    const wallet = prompt('Direccion de wallet destino:');
    const amount = prompt('Cantidad a transferir:');
    if (wallet && amount) {
      ejecutarAccion('transfer', { to: wallet, amount: amount });
    }
  };
  if (deleteBtn) deleteBtn.onclick = () => {
    const amount = prompt('Cantidad a quemar (burn):');
    if (amount) {
      ejecutarAccion('burn', { wallet_address: publicKey, amount: amount });
    }
  };
  if (getBtn) getBtn.onclick = () => ejecutarAccion('get_balance', { wallet_address: publicKey });
});

function scvAddress(pubKey) {
  const keypair = StellarSdk.Keypair.fromPublicKey(pubKey);
  return StellarSdk.xdr.ScVal.scvAddress(keypair.xdrAccountId());
}

function scvI128(value) {
  const num = BigInt(Math.floor(Number(value)));
  const hi = Number(num >> 64n);
  const lo = Number(num & 0xFFFFFFFFFFFFFFFFn);
  const bits = new StellarSdk.xdr.Int128Parts({ lo: new StellarSdk.xdr.Uint64(lo), hi: new StellarSdk.xdr.Int64(hi) });
  return StellarSdk.xdr.ScVal.scvI128(bits);
}
