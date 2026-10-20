// N'accepte que des chemins internes ("/commande"), pas "//site.com" : évite les redirections ouvertes
export function safeRedirect(target: string | null | undefined, fallback = '/') {
  return target && target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\') ? target : fallback;
}

// URL de la page de connexion qui ramène ensuite à la page courante
export function loginUrl(current: URL) {
  return `/compte/connexion?redirect=${encodeURIComponent(current.pathname + current.search)}`;
}
