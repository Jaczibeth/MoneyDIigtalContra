class PasskeyHelper {
  constructor(apiBase = '') {
    this.apiBase = apiBase;
  }

  buf2base64url(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer);
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
    return bytes.buffer;
  }

  serializeCredential(cred) {
    const out = { id: cred.id, rawId: this.buf2base64url(cred.rawId), response: {}, type: cred.type };
    if (cred.response.clientDataJSON) out.response.clientDataJSON = this.buf2base64url(cred.response.clientDataJSON);
    if (cred.response.attestationObject) out.response.attestationObject = this.buf2base64url(cred.response.attestationObject);
    if (cred.response.authenticatorData) out.response.authenticatorData = this.buf2base64url(cred.response.authenticatorData);
    if (cred.response.signature) out.response.signature = this.buf2base64url(cred.response.signature);
    if (cred.response.userHandle) out.response.userHandle = this.buf2base64url(cred.response.userHandle);
    if (cred.response.getTransports) out.response.transports = cred.response.getTransports();
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
      allowCredentials: (opts.allowCredentials || []).map(c => ({ ...c, id: this.base64url2buf(c.id) }))
    };
  }

  async registerPasskey(username) {
    if (!navigator.credentials?.create) {
      throw new Error('Tu navegador no soporta WebAuthn. Usa Chrome, Edge o Safari.');
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

    const credential = await navigator.credentials.create({
      publicKey: this.prepareCreationOpts(creationOpts)
    });

    const completeRes = await fetch(`${this.apiBase}/api/auth/passkey/register/complete`, {
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

    const assertion = await navigator.credentials.get({
      publicKey: this.prepareRequestOpts(requestOpts)
    });

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

  async hasPasskey(username) {
    try {
      const res = await fetch(`${this.apiBase}/api/auth/passkey/has-passkey/${encodeURIComponent(username)}`);
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
}
