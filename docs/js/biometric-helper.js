class BiometricHelper {
  static async isSupported() {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  static canUseWebAuthn() {
    return !!(navigator.credentials && typeof navigator.credentials.create === 'function' && typeof navigator.credentials.get === 'function');
  }

  static async getSupportStatus() {
    const webAuthn = this.canUseWebAuthn();
    const platform = webAuthn ? await this.isSupported() : false;
    return { webAuthn, platformBiometric: platform };
  }

  static showConsentDialog(username) {
    return new Promise((resolve) => {
      const existing = document.getElementById('bioConsentOverlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'bioConsentOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';

      const modal = document.createElement('div');
      modal.style.cssText = 'background:#1a1a2e;border:1px solid rgba(0,255,255,0.2);border-radius:20px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 0 40px rgba(0,229,255,0.1);';

      modal.innerHTML = `
        <div style="font-size:52px;margin-bottom:12px;">🔐</div>
        <h2 style="color:#00eaff;font-size:1.4rem;margin-bottom:8px;font-weight:700;">¿Activar inicio rápido?</h2>
        <p style="color:#aaa;font-size:0.9rem;margin-bottom:24px;line-height:1.5;">
          Puedes iniciar sesión con tu <strong>huella digital</strong>, <strong>Face ID</strong> o <strong>PIN</strong> del dispositivo en lugar de escribir tu contraseña cada vez.
        </p>
        <div style="display:flex;gap:12px;">
          <button id="bioConsentNo" style="flex:1;padding:12px 16px;border-radius:12px;background:rgba(255,255,255,0.08);color:white;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-weight:600;font-size:0.9rem;transition:0.2s;">Ahora no</button>
          <button id="bioConsentYes" style="flex:1;padding:12px 16px;border-radius:12px;background:linear-gradient(135deg,#00eaff,#8a00ff);color:white;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;transition:0.2s;">✅ Activar</button>
        </div>
        <button id="bioConsentNever" style="margin-top:16px;background:none;border:none;color:#555;cursor:pointer;font-size:0.8rem;padding:8px;">No volver a preguntar</button>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      document.getElementById('bioConsentYes').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      document.getElementById('bioConsentNo').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      document.getElementById('bioConsentNever').onclick = () => {
        overlay.remove();
        localStorage.setItem('bio_consent_skipped', 'true');
        resolve(null);
      };
    });
  }

  static showBiometricFallback(containerId, onRetryBiometric, onUsePassword) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `
      <div style="text-align:center;padding:20px;">
        <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
        <p style="color:#ffa726;font-weight:600;margin-bottom:4px;">Verificación biométrica no disponible</p>
        <p style="color:#888;font-size:0.85rem;margin-bottom:20px;">
          Tu dispositivo no pudo completar la autenticación biométrica o cancelaste el proceso.
        </p>
        <div style="display:flex;gap:12px;justify-content:center;">
          <button id="retryBiometricBtn" style="padding:12px 20px;border-radius:12px;background:rgba(0,229,255,0.1);color:#00eaff;border:1px solid rgba(0,229,255,0.3);cursor:pointer;font-weight:600;font-size:0.9rem;">
            🔄 Intentar de nuevo
          </button>
          <button id="fallbackPasswordBtn" style="padding:12px 20px;border-radius:12px;background:rgba(255,255,255,0.08);color:white;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-weight:600;font-size:0.9rem;">
            ⌨️ Usar contraseña
          </button>
        </div>
      </div>
    `;
    document.getElementById('retryBiometricBtn')?.addEventListener('click', onRetryBiometric);
    document.getElementById('fallbackPasswordBtn')?.addEventListener('click', onUsePassword);
  }

  static hideBiometricFallback(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
  }

  static async registerAfterConsent(username, passkeyHelper) {
    const supported = await this.isSupported();
    if (!supported) {
      throw new Error('Este dispositivo no tiene hardware biométrico compatible (huella/Face ID/PIN).');
    }
    return await passkeyHelper.registerPasskey(username);
  }

  static showBiometricUnsupportedMessage(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `
      <div style="padding:16px;border-radius:12px;background:rgba(255,152,0,0.1);border:1px solid rgba(255,152,0,0.2);text-align:center;">
        <span style="font-size:28px;">📱</span>
        <p style="color:#ffa726;font-weight:600;margin:8px 0 4px;">Biometría no disponible en este dispositivo</p>
        <p style="color:#888;font-size:0.85rem;">
          Tu navegador o dispositivo no tiene soporte para huella digital, Face ID o Windows Hello.
          Puedes seguir usando la plataforma con tu contraseña normal.
        </p>
      </div>
    `;
  }
}
