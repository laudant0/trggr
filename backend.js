let backendPromise;

export function isBackendConfigured() {
  const config = window.TRGGR_AUTH_CONFIG || {};
  return Boolean(config.supabaseUrl && config.supabasePublishableKey);
}

export function getBackend() {
  if (!isBackendConfigured()) return Promise.resolve(null);
  if (!backendPromise) {
    backendPromise = (async () => {
      const config = window.TRGGR_AUTH_CONFIG;
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      return createClient(config.supabaseUrl, config.supabasePublishableKey);
    })();
  }
  return backendPromise;
}
