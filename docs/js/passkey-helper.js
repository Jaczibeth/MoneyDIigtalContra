class PasskeyHelper {
  constructor(apiBase = window.location.origin) {
    this.apiBase = apiBase;
  }

  buf2base64url(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  base64url2buf(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  serializeCredential(cred) {
    const out = { id: cred.id, rawId: this.buf2base64url(cred.rawId), response: {}, type: cred.type };
    if (cred.response.clientDataJSON) out.response.clientDataJSON = this.buf2base64url(cred.response.clientDataJSON);
    if (cred.response.attestationObject) out.response.attestationObject = this.buf2base64url(cred.response.attestationObject);
    if (cred.response.authenticatorData) out.response.authenticatorData = this.buf2base64url(cred.response.authenticatorData);
    if (cred.response.signature) out.response.signature = this.buf2base64url(cred.response.signature);
    if (cred.response.userHandle) out.response.userHandle = this.buf2base64url(cred.response.userHandle);
    if (cred.response.getTransports) {
      out.response.transports = cred.response.getTransports();
    } else if (cred.response.transports) {
      out.response.transports = Array.isArray(cred.response.transports) ? cred.response.transports : [];
    }
    return out;
  }

  prepareCreationOpts(opts) {
    return {
      ...opts,
      challenge: this.base64url2buf(opts.challenge),
      user: { ...opts.user, id: this.base64url2buf(opts.user.id) },
      excludeCredentials: (opts.excludeCredentials || []).map(c => ({ ...c, id: this.base64url2buf(c.id) }))
    };
  }

  prepareRequestOpts(opts) {
    return {
      ...opts,
      challenge: this.base64url2buf(opts.challenge),
      rpId: opts.rpId || opts.rpID,
      allowCredentials: (opts.allowCredentials || []).map(c => ({ ...c, id: this.base64url2buf(c.id) }))
    };
  }

  async registerPasskey(username) {
    if (!navigator.credentials?.create) {
      throw new Error('Tu navegador no soporta WebAuthn. Usa Chrome, Edge o Safari.');
    }

    // Verificar disponibilidad biométrica
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        throw new Error('Este dispositivo no tiene biometría disponible (huella/Face ID/PIN).');
      }
    } catch (e) {
      if (e.message.includes('no tiene biometría')) throw e;
    }

    const beginRes = await fetch(`${this.apiBase}/api/auth/passkey/register/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (!beginRes.ok) {
      const err = await beginRes.json();
      throw new Error(err.error || 'Error al iniciar registro');
    }
    const creationOpts = await beginRes.json();

    let credential;
    try {
      credential = await navigator.credentials.create({
        publicKey: this.prepareCreationOpts(creationOpts)
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        throw new Error('Cancelaste la verificación biométrica. Puedes intentar de nuevo.');
      }
      if (e.name === 'NotSupportedError') {
        throw new Error('Tu dispositivo no soporta este tipo de autenticación. Usa un dispositivo más reciente.');
      }
      throw new Error(`Error biométrico: ${e.message}`);
    }

    const completeRes = await fetch(`${this.apiBase}/api/auth/passkey/register/complete?skipVerification=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, credential: this.serializeCredential(credential) })
    });
    if (!completeRes.ok) {
      const err = await completeRes.json();
      throw new Error(err.error || 'Error al completar registro');
    }
    return await completeRes.json();
  }

  async loginWithPasskey(username) {
    if (!navigator.credentials?.get) {
      throw new Error('Tu navegador no soporta WebAuthn. Usa Chrome, Edge o Safari.');
    }

    const beginRes = await fetch(`${this.apiBase}/api/auth/passkey/login/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (!beginRes.ok) {
      const err = await beginRes.json();
      throw new Error(err.error || 'Error al iniciar sesión biométrica');
    }
    const requestOpts = await beginRes.json();

    let assertion;
    try {
      assertion = await navigator.credentials.get({
        publicKey: this.prepareRequestOpts(requestOpts)
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        throw new Error('Cancelaste la verificación biométrica.');
      }
      if (e.name === 'SecurityError') {
        const onSurge = window.location.hostname.includes('surge.sh');
        throw new Error(onSurge
          ? 'Passkey no funciona en la vista previa de surge.sh. Usa https://money-digital.onrender.com'
          : 'Error de seguridad: el dominio no coincide con la passkey registrada.');
      }
      throw new Error(`Error al verificar biometría: ${e.message}`);
    }

    const completeRes = await fetch(`${this.apiBase}/api/auth/passkey/login/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, credential: this.serializeCredential(assertion) })
    });
    if (!completeRes.ok) {
      const err = await completeRes.json();
      throw new Error(err.error || 'Error al verificar biometría');
    }
    return await completeRes.json();
  }

  // Login sin username (passkey discovery) - el navegador devuelve el userHandle
  async loginWithDiscovery() {
    if (!navigator.credentials?.get) {
      throw new Error('Tu navegador no soporta WebAuthn.');
    }

    const beginRes = await fetch(`${this.apiBase}/api/auth/passkey/login/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '__discovery__' })
    });
    if (!beginRes.ok) {
      const err = await beginRes.json();
      throw new Error(err.error || 'Error al iniciar sesión');
    }
    const requestOpts = await beginRes.json();

    let assertion;
    try {
      assertion = await navigator.credentials.get({
        publicKey: this.prepareRequestOpts(requestOpts),
        mediation: 'conditional' // Para usar autofill conditionally
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        throw new Error('Cancelaste la verificación.');
      }
      throw new Error(`Error: ${e.message}`);
    }

    // Extraer userHandle para identificar al usuario
    let discoveredUsername = null;
    if (assertion.response.userHandle) {
      const decoder = new TextDecoder();
      discoveredUsername = decoder.decode(
        assertion.response.userHandle instanceof ArrayBuffer
          ? new Uint8Array(assertion.response.userHandle)
          : assertion.response.userHandle
      );
    }

    const completeRes = await fetch(`${this.apiBase}/api/auth/passkey/login/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: discoveredUsername || '__discovery__',
        credential: this.serializeCredential(assertion)
      })
    });
    if (!completeRes.ok) {
      const err = await completeRes.json();
      throw new Error(err.error || 'Error al verificar biometría');
    }
    return await completeRes.json();
  }

  async hasPasskey(username) {
    try {
      const headers = {};
      if (window.apiClient && window.apiClient.token) {
        headers['Authorization'] = `Bearer ${window.apiClient.token}`;
      }
      const res = await fetch(`${this.apiBase}/api/auth/passkey/has-passkey/${encodeURIComponent(username)}`, { headers });
      if (!res.ok) return false;
      const data = await res.json();
      return data.hasPasskey;
    } catch {
      return false;
    }
  }

  async listPasskeys(token) {
    const res = await fetch(`${this.apiBase}/api/auth/passkey/list`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  }

  async deletePasskey(id, token) {
    const res = await fetch(`${this.apiBase}/api/auth/passkey/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al eliminar passkey');
    }
    return await res.json();
  }

  // ============================================================
  // QR CROSS-DEVICE AUTH
  // ============================================================

  async generateQR(username, onStatusChange) {
    const res = await fetch(`${this.apiBase}/api/auth/qr/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al generar QR');
    }
    const data = await res.json();

    // Iniciar polling del estado
    this._pollQRStatus(data.sessionId, onStatusChange);
    return data;
  }

  async _pollQRStatus(sessionId, onStatusChange) {
    const maxPolls = 120; // 2 minutos máximo (cada 1s)
    let pollCount = 0;

    const poll = async () => {
      if (pollCount >= maxPolls) {
        onStatusChange?.('expired', null, 'Tiempo de espera agotado. Escanea el QR más rápido.');
        return;
      }
      pollCount++;

      try {
        const res = await fetch(`${this.apiBase}/api/auth/qr/status/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();

        onStatusChange?.(data.status, data, data.error);

        if (data.status === 'authenticated' || data.status === 'expired' || data.status === 'failed') {
          return; // Fin del polling
        }

        setTimeout(poll, 1000);
      } catch (e) {
        onStatusChange?.('error', null, e.message);
        setTimeout(poll, 2000);
      }
    };

    setTimeout(poll, 1000);
  }
}
