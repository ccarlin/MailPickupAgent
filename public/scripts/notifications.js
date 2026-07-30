const Notifications = {
  publicKey: null,
  isSubscribed: false,
  swRegistration: null,

  async init() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push messaging is not supported');
      return;
    }

    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      const response = await fetch('/notifications/public-key');
      const data = await response.json();
      this.publicKey = data.publicKey;

      const subscription = await this.swRegistration.pushManager.getSubscription();
      if (subscription) {
        try {
          const checkRes = await fetch(`/notifications/check?endpoint=${encodeURIComponent(subscription.endpoint)}`);
          const checkData = await checkRes.json();
          this.isSubscribed = checkData.registered;
        } catch {
          this.isSubscribed = false;
        }
      } else {
        this.isSubscribed = false;
      }
      this.updateUI();
    } catch (err) {
      console.error('Service Worker registration failed: ', err);
    }
  },

  updateUI() {
    const btn = document.querySelector('.myMiniButton#subscribe-btn') || document.getElementById('subscribe-btn');
    if (!btn) return;

    if (this.isSubscribed) {
      btn.textContent = 'Notifications: ON';
      btn.classList.add('subscribed');
      btn.style.backgroundColor = '#28a745';
      btn.style.color = 'white';
    } else {
      btn.textContent = 'Notifications: OFF';
      btn.classList.remove('subscribed');
      btn.style.backgroundColor = '';
      btn.style.color = '';
    }
  },

  async toggleSubscription(emailFilter = null) {
    if (this.isSubscribed) {
      await this.unsubscribe();
    } else {
      await this.subscribe(emailFilter);
    }
    this.updateUI();
  },

  async subscribe(emailFilter) {
    const applicationServerKey = this.urlB64ToUint8Array(this.publicKey);
    try {
      const subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
      });

      await fetch('/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, emailFilter })
      });

      this.isSubscribed = true;
      console.log('User is subscribed.');
    } catch (err) {
      console.error('Failed to subscribe the user: ', err);
    }
  },

  async unsubscribe() {
    try {
      const subscription = await this.swRegistration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        await fetch('/notifications/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
      }
      this.isSubscribed = false;
      console.log('User is unsubscribed.');
    } catch (err) {
      console.error('Error unsubscribing', err);
    }
  },

  urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
};

window.addEventListener('load', () => {
  Notifications.init();
});
