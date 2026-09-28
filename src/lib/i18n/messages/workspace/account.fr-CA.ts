import type { accountEn } from "./account.en";

/** Français québécois — auth, settings, notifications, onboarding, account (#141). À faire réviser. */
export const accountFrCA: typeof accountEn = {
  auth: {
    tagline:
      "Travail, communication et opérations de programmes sécurisés pour le Quebec Board of Black Educators.",
    signIn: {
      title: "Connexion",
      submit: "Se connecter",
      badCredentials:
        "Ce courriel et ce mot de passe ne correspondent pas. Vérifiez-les et réessayez.",
      forgot: "Mot de passe oublié?",
      newHere: "Nouveau sur QBBE Hub?",
      createAccount: "Créer un compte",
    },
    signUp: {
      title: "Créer un compte",
      fullName: "Nom complet",
      passwordHint: "Au moins 8 caractères.",
      submit: "Créer le compte",
      haveAccount: "Vous avez déjà un compte?",
      signIn: "Se connecter",
      checkFailed: "Impossible de vérifier si l’inscription est ouverte. Réessayez.",
      inviteOnly:
        "Cet espace de travail est sur invitation seulement. Demandez à un administrateur de vous envoyer une invitation.",
      checkEmail: "Vérifiez vos courriels",
      confirmationSent:
        "Nous avons envoyé un lien de confirmation à {email}. Suivez-le pour terminer la création de votre compte.",
    },
    recovery: {
      requestTitle: "Récupérer le compte",
      resetTitle: "Réinitialiser le mot de passe",
      requestHeading: "Récupérer votre compte",
      resetHeading: "Choisir un nouveau mot de passe",
      requestDone:
        "Si cette adresse correspond à un compte, un lien de récupération arrivera sous peu. Ouvrez-le dans ce navigateur.",
      resetDone:
        "Votre mot de passe a été modifié. Connectez-vous avec votre nouveau mot de passe.",
      passwordRules:
        "Utilisez au moins 12 caractères. Votre espace de travail peut exiger des mesures de protection supplémentaires.",
      newPassword: "Nouveau mot de passe",
      confirmPassword: "Confirmer le mot de passe",
      sendLink: "Envoyer le lien de récupération",
      savePassword: "Enregistrer le mot de passe",
      requestFailed: "Impossible de demander la récupération. Patientez un moment et réessayez.",
      mismatch: "Les mots de passe ne correspondent pas.",
      updateFailed:
        "Impossible de modifier votre mot de passe. Vérifiez les exigences ou demandez un nouveau lien de récupération.",
      failed: "Impossible de terminer la récupération. Veuillez réessayer.",
      sessionMissing: "Votre session de récupération est absente ou a expiré.",
      requestNewLink: "Demander un nouveau lien de récupération",
    },
  },
  settings: {
    title: "Paramètres du compte",
    eyebrow: "Compte",
    heading: "Paramètres",
    description:
      "Gérez la façon dont QBBE Hub vous avise. Les administrateurs gèrent séparément les paramètres par défaut de l’organisation.",
  },
  notifications: {},
  onboarding: {},
  account: {},
};
