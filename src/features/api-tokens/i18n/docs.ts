import type { Locale } from "@/lib/i18n/config";

/**
 * The private API's reference (V2-8), in both languages. Endpoints and field
 * names are code and stay as they are.
 */

export interface DocsSection {
  id: string;
  heading: string;
  paragraphs: string[];
  code?: string;
}

export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  scope: string;
  description: string;
}

const endpointsEn: Endpoint[] = [
  { method: "GET", path: "/api/v1/me", scope: "any", description: "Who the token acts as, and its scopes." },
  { method: "GET", path: "/api/v1/objects?type=task&limit=50&cursor=…", scope: "objects:read", description: "Objects the person may view, newest change first. Up to 100 a page; follow nextCursor." },
  { method: "GET", path: "/api/v1/objects/{id}", scope: "objects:read", description: "One object. Not found if it does not exist or the person may not view it." },
  { method: "GET", path: "/api/v1/objects/{id}/properties", scope: "objects:read", description: "Its properties: title, owner and times for every object; a task's status, priority, dates and people too." },
  { method: "GET", path: "/api/v1/objects/{id}/relations", scope: "objects:read", description: "Its parent, children and (for a task) project, each only if the person may view it." },
  { method: "GET", path: "/api/v1/actions", scope: "actions:run", description: "The actions you can run." },
  { method: "POST", path: "/api/v1/actions/{key}", scope: "actions:run", description: "Runs one action with { \"input\": { … } }. Checked on every object it touches." },
];

const endpointsFr: Endpoint[] = [
  { method: "GET", path: "/api/v1/me", scope: "toute", description: "Au nom de qui le jeton agit, et ses portées." },
  { method: "GET", path: "/api/v1/objects?type=task&limit=50&cursor=…", scope: "objects:read", description: "Les objets que la personne peut voir, du plus récemment modifié au plus ancien. Jusqu’à 100 par page; suivez nextCursor." },
  { method: "GET", path: "/api/v1/objects/{id}", scope: "objects:read", description: "Un objet. Introuvable s’il n’existe pas ou si la personne ne peut pas le voir." },
  { method: "GET", path: "/api/v1/objects/{id}/properties", scope: "objects:read", description: "Ses propriétés : titre, responsable et dates pour tout objet; aussi le statut, la priorité, les dates et les personnes d’une tâche." },
  { method: "GET", path: "/api/v1/objects/{id}/relations", scope: "objects:read", description: "Son parent, ses enfants et (pour une tâche) son projet, chacun seulement si la personne peut le voir." },
  { method: "GET", path: "/api/v1/actions", scope: "actions:run", description: "Les actions que vous pouvez exécuter." },
  { method: "POST", path: "/api/v1/actions/{key}", scope: "actions:run", description: "Exécute une action avec { \"input\": { … } }. Vérifiée sur chaque objet touché." },
];

const example = `curl -H "Authorization: Bearer qbbe_…" \\
  "https://<hub>/api/v1/objects?type=task&limit=20"

curl -X POST -H "Authorization: Bearer qbbe_…" \\
  -H "content-type: application/json" \\
  -d '{"input":{"taskId":"<id>","status":"completed"}}' \\
  "https://<hub>/api/v1/actions/task.set_status"`;

const errorsExample = `{ "error": { "code": "insufficient_scope", "message": "This call needs the actions:run scope." } }`;

const webhookExample = `X-QBBE-Signature: t=1760000000,v1=<hex HMAC-SHA256 of "1760000000.<raw body>">`;

const sectionsEn: DocsSection[] = [
  { id: "auth", heading: "Authentication", paragraphs: [
    "Make a token on the API access tokens page and send it in the Authorization header on every call. A token belongs to one person in one organization, has scopes and an expiry of at most a year, and can be revoked at any time.",
    "Every call acts as that person: it sees and changes exactly what they could in the Hub, at the first sign-in level. What needs a two-step sign-in (most administrator changes) is refused.",
  ], code: example },
  { id: "versions", heading: "Versions", paragraphs: [
    "The version is in the path (/api/v1). Fields may be added to v1 answers; nothing is removed or renamed within v1.",
  ] },
  { id: "errors", heading: "Errors", paragraphs: [
    "Errors are JSON with a code and a sentence. 400 invalid_query, invalid_body or invalid_cursor; 401 unauthenticated or invalid_token; 403 insufficient_scope or forbidden; 404 not_found or unknown_action; 422 action_failed; 429 rate_limited (see Retry-After).",
  ], code: errorsExample },
  { id: "limits", heading: "Limits and audit", paragraphs: [
    "Each token may make 120 calls a minute. Every call, allowed or refused, is recorded with the token, the person, the path, the result and the time; the token's owner and the organization's administrators can see the record.",
  ] },
  { id: "webhooks", heading: "Webhooks", paragraphs: [
    "Workflows can call your systems with a webhook step. Each request is a signed JSON POST: check the signature with the workflow's signing key (shown on the workflow) and reject timestamps older than five minutes.",
  ], code: webhookExample },
];

const sectionsFr: DocsSection[] = [
  { id: "auth", heading: "Authentification", paragraphs: [
    "Créez un jeton sur la page des jetons d’accès et envoyez-le dans l’en-tête Authorization à chaque appel. Un jeton appartient à une personne dans une organisation, a des portées et expire au plus tard après un an; il peut être révoqué en tout temps.",
    "Chaque appel agit au nom de cette personne : il voit et modifie exactement ce qu’elle pourrait dans le Hub, au premier niveau de connexion. Ce qui exige une connexion en deux étapes (la plupart des changements d’administration) est refusé.",
  ], code: example },
  { id: "versions", heading: "Versions", paragraphs: [
    "La version est dans le chemin (/api/v1). Des champs peuvent s’ajouter aux réponses v1; rien n’est retiré ni renommé dans la v1.",
  ] },
  { id: "errors", heading: "Erreurs", paragraphs: [
    "Les erreurs sont en JSON, avec un code et une phrase. 400 invalid_query, invalid_body ou invalid_cursor; 401 unauthenticated ou invalid_token; 403 insufficient_scope ou forbidden; 404 not_found ou unknown_action; 422 action_failed; 429 rate_limited (voir Retry-After).",
  ], code: errorsExample },
  { id: "limits", heading: "Limites et journal", paragraphs: [
    "Chaque jeton peut faire 120 appels par minute. Chaque appel, permis ou refusé, est consigné avec le jeton, la personne, le chemin, le résultat et l’heure; la personne à qui appartient le jeton et les administrateurs de l’organisation peuvent le consulter.",
  ] },
  { id: "webhooks", heading: "Webhooks", paragraphs: [
    "Les flux de travail peuvent appeler vos systèmes avec une étape webhook. Chaque requête est un POST JSON signé : vérifiez la signature avec la clé du flux (affichée sur le flux) et refusez les horodatages de plus de cinq minutes.",
  ], code: webhookExample },
];

export function apiDocs(locale: Locale) {
  return locale === "fr-CA"
    ? { sections: sectionsFr, endpoints: endpointsFr, endpointsHeading: "Points d’accès", method: "Méthode", path: "Chemin", scope: "Portée", what: "Ce que ça fait" }
    : { sections: sectionsEn, endpoints: endpointsEn, endpointsHeading: "Endpoints", method: "Method", path: "Path", scope: "Scope", what: "What it does" };
}
