import type { accountEn } from "./account.en";

/** Français québécois — auth, settings, notifications, onboarding, account, privacy (#141). À faire réviser. */
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
    password: {
      hint: "Au moins {min} caractères, dont une minuscule, une majuscule et un chiffre.",
      tooShort: "Utilisez au moins {min} caractères.",
      tooLong: "Utilisez au plus {max} caractères.",
      needsMix: "Incluez une minuscule, une majuscule et un chiffre.",
    },
    signUp: {
      title: "Créer un compte",
      fullName: "Nom complet",
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
    mfa: {
      title: "Authentification multifacteur",
      accountantHeading: "Protégez votre accès de comptable",
      adminHeading: "Protégez votre compte administrateur",
      accountantBody: "QBBE Hub exige un code d’authentificateur avant d’ouvrir les livres.",
      adminBody:
        "QBBE Hub exige un code d’authentificateur pour les propriétaires et les administrateurs.",
      loading: "Chargement de la vérification de sécurité…",
      checking: "Vérification de vos paramètres de sécurité…",
      preparing: "Préparation de la configuration de l’authentificateur…",
      retry: "Réessayer",
      signOut: "Se déconnecter",
      setupHeading: "Configurer un authentificateur",
      setupBody:
        "Balayez ce code QR avec votre application d’authentification, puis entrez son code à six chiffres.",
      qrAlt: "Code QR pour configurer l’authentificateur QBBE Hub",
      cantScan: "Impossible de balayer le code QR?",
      manualHelp: "Entrez manuellement cette clé de configuration dans votre application d’authentification.",
      challengeHeading: "Entrez votre code de sécurité",
      challengeBody:
        "Ouvrez votre application d’authentification et entrez le code actuel pour QBBE Hub.",
      lostAccess:
        "Vous n’avez plus accès à aucun authentificateur? Déconnectez-vous et communiquez avec le gardien des identifiants de QBBE. La réinitialisation d’un facteur exige une récupération vérifiée par un opérateur.",
      authenticator: "Authentificateur",
      codeLabel: "Code à six chiffres",
      codeHelp: "Les codes changent toutes les 30 secondes.",
      enable: "Activer l’AMF",
      verify: "Vérifier et continuer",
      enterCode: "Entrez le code à six chiffres de votre application d’authentification.",
      chooseAuthenticator: "Choisissez un authentificateur et réessayez.",
      friendlyName: "Authentificateur QBBE Hub",
      fallbackName: "Authentificateur {number}",
      errors: {
        expired:
          "Ce code a expiré. Attendez un nouveau code dans votre application d’authentification et réessayez.",
        rejected: "Ce code n’a pas été accepté. Vérifiez les six chiffres et réessayez.",
        inProgress:
          "La configuration d’un authentificateur est déjà en cours. Relancez la configuration pour continuer.",
        unavailable:
          "L’authentification multifacteur est temporairement indisponible. Réessayez.",
      },
      audit: {
        invalidEvent: "Événement de sécurité non valide.",
        verifyFailed: "Impossible de vérifier la piste d’audit de sécurité.",
        recordFailed: "Impossible d’enregistrer l’événement de sécurité.",
      },
    },
  },
  settings: {
    title: "Paramètres du compte",
    eyebrow: "Compte",
    heading: "Paramètres",
    description:
      "Gérez la façon dont QBBE Hub vous avise. Les administrateurs gèrent séparément les paramètres par défaut de l’organisation.",
    delivery: {
      heading: "Préférences de livraison",
      intro: "Choisissez comment QBBE Hub vous joint à l’extérieur de l’espace de travail.",
      emailCritical: "M’envoyer un courriel pour l’activité critique",
      emailCriticalHint: "Affectations, mentions, échéances et annonces urgentes.",
      dailyDigest: "Résumé quotidien",
      dailyDigestHint:
        "Un résumé des mises à jour non urgentes, lorsque l’envoi des résumés est configuré.",
      quietStart: "Début des heures de silence",
      quietEnd: "Fin des heures de silence",
      noQuietHours: "Aucune heure de silence",
      quietNote:
        "Les annonces critiques obligatoires peuvent quand même être livrées pendant les heures de silence.",
      save: "Enregistrer les préférences",
      saved: "Préférences de notification enregistrées.",
      saveFailed: "Impossible d’enregistrer les préférences.",
    },
    channels: {
      heading: "Notifications des canaux",
      intro: "Gérez les notifications des canaux dont vous êtes membre.",
      empty: "Joignez-vous à un canal pour en régler les notifications.",
      selectLabel: "Notifications pour {channel}",
      all: "Toute l’activité",
      mentions: "Mentions seulement",
      muted: "En sourdine",
      updateFailed: "Impossible de mettre à jour ce canal.",
    },
    display: {
      heading: "Affichage",
      reduceMotion: "Réduire les animations",
      reduceMotionHelp:
        "Désactive les animations et le défilement fluide dans QBBE Hub, même si votre appareil n’est pas réglé pour réduire les animations.",
      saveFailed: "Impossible d’enregistrer le paramètre.",
    },
    mfa: {
      heading: "Authentification multifacteur",
      body: "Les propriétaires et les administrateurs doivent valider un authentificateur avant d’effectuer des tâches privilégiées. Gardez un deuxième authentificateur à portée de main pour qu’un appareil perdu n’exige pas une récupération par un opérateur.",
      add: "Ajouter un authentificateur",
      added: "Authentificateur ajouté.",
      removed: "Authentificateur retiré.",
      keepOne: "Les administrateurs doivent conserver au moins un authentificateur vérifié.",
      qrAlt: "Code QR du nouvel authentificateur QBBE Hub",
      manualKey: "Clé de configuration manuelle",
      codeLabel: "Code à six chiffres",
      verifyAndAdd: "Vérifier et ajouter",
      cancel: "Annuler",
      verified: "Authentificateur vérifié",
      addAnotherFirst: "Ajoutez un autre authentificateur avant de retirer celui-ci.",
      remove: "Retirer",
      lostAll:
        "Vous avez perdu tous vos authentificateurs? Communiquez avec le gardien des identifiants de QBBE. Une réinitialisation exige une vérification d’identité, un deuxième opérateur autorisé et une entrée au journal d’audit.",
      removeTitle: "Retirer l’authentificateur",
      removeConfirm:
        "Retirer {name}? Il vous faudra un autre authentificateur vérifié la prochaine fois que QBBE Hub demandera une vérification pour ce compte.",
      removeButton: "Retirer l’authentificateur",
      friendlyName: "Authentificateur QBBE Hub {number}",
    },
  },
  notifications: {
    page: {
      title: "Préférences de courriel",
      eyebrow: "Paramètres",
      heading: "Préférences de courriel",
      description:
        "Choisissez ce qui arrive dans votre boîte de courriel, et quand. Tout continue d’apparaître dans le Hub de toute façon.",
      recentHeading: "Courriels récents qui vous ont été envoyés",
      recentEmpty:
        "Rien n’a encore été envoyé. Les courriels du Hub apparaîtront ici avec leur état de livraison.",
      sentAt: "envoyé le {when}",
      heldUntil: "retenu jusqu’au {when}",
      status: {
        sent: "envoyé",
        queued: "en file d’attente",
        sending: "en cours d’envoi",
        bounced: "rejeté",
        failed: "échec",
        suppressed: "non envoyé",
      },
    },
    form: {
      whatToEmail: "Sujets pour lesquels m’envoyer un courriel",
      categories: {
        assignment: {
          label: "Travail qui m’est confié",
          hint: "Tâches, révisions et décisions. Les approbations suivent ce choix.",
        },
        mention: {
          label: "Mentions et réponses",
          hint: "Quelqu’un vous nomme ou répond à un fil que vous avez lancé.",
        },
        announcement: {
          label: "Annonces",
          hint: "Publications pour tout l’espace de travail. Celles qui exigent un accusé de lecture arrivent toujours.",
        },
        due_date: {
          label: "Échéances",
          hint: "Travail dû aujourd’hui, demain ou en retard.",
        },
      },
      modes: {
        immediate: "Immédiatement",
        daily: "Résumé quotidien",
        weekly: "Résumé hebdomadaire",
        off: "Aucun courriel",
      },
      urgent: "Me joindre sans délai pour le travail urgent",
      urgentHint:
        "Les éléments urgents réglés pour arriver immédiatement arrivent même pendant les heures de silence. Une catégorie quotidienne ou hebdomadaire attend le résumé. Les avis de sécurité arrivent toujours.",
      quietHeading: "Heures de silence",
      quietToggle: "Retenir les courriels courants pendant la nuit",
      quietHint:
        "Les courriels sont retardés jusqu’à la fin de la plage, jamais supprimés. Les avis de sécurité et les annonces qui exigent un accusé de lecture arrivent quand même.",
      from: "De",
      until: "À",
      digestHeading: "Envoi des résumés",
      digestIntro:
        "Les catégories quotidiennes sont envoyées chaque jour à cette heure. Les catégories hebdomadaires sont envoyées le jour choisi. Rien n’est envoyé lorsqu’il n’y a rien à signaler.",
      sendAt: "Envoyer à",
      weeklyOn: "Chaque semaine le",
      timeZone: "Fuseau horaire",
      zoneHint: "Les heures de silence et le résumé utilisent tous deux ce fuseau.",
      muteHeading: "Projets en sourdine",
      muteIntro:
        "Les courriels non critiques et les éléments de la boîte de réception d’un projet en sourdine restent silencieux. Les avis de sécurité et les annonces obligatoires arrivent quand même.",
      noProjects: "Aucun projet à mettre en sourdine.",
      save: "Enregistrer les préférences",
      saved: "Préférences enregistrées.",
      saveFailed: "Impossible d’enregistrer.",
    },
    errors: {
      invalid: "Ces préférences ne sont pas valides.",
      badTimezone: "Ce fuseau horaire n’est pas reconnu.",
      quietBothEnds:
        "Indiquez un début et une fin pour les heures de silence, ou effacez les deux.",
      saveFailed: "Impossible d’enregistrer vos préférences.",
      unknownThread: "Fil inconnu.",
      threadFailed: "Impossible de mettre à jour ce fil.",
    },
    email: {
      reasons: {
        assigned: "attribution",
        mentioned: "mention",
        reply: "réponse",
        approved: "approbation",
        decisionRequested: "décision demandée",
        dueDateChanged: "échéance modifiée",
        dueDate: "échéance",
        grantReportDue: "rapport de subvention à remettre",
        projectClosed: "projet fermé",
        resubmitted: "soumis de nouveau",
        reviewRequested: "révision demandée",
        role: "rôle",
        sponsor: "parrainage",
        staleProject: "projet sans mise à jour",
        workSignal: "signal de travail",
        announcement: "annonce",
      },
      categories: {
        assignment: "Qui vous est confié",
        mention: "Mentions",
        reply: "Réponses",
        announcement: "Annonces",
        due_date: "Échéances",
        approval: "Approbations",
        decision: "Décisions",
        security: "Sécurité",
        system: "Mises à jour",
        activity: "Activité générale",
        upcoming: "Échéances à venir",
        overdue: "Travail en retard",
        stale: "Projets inactifs",
        meetings: "Rappels de réunion",
      },
      fallbackCategory: "Mises à jour",
      detailLine: "{label} : {value}",
      detail: {
        action: "Action",
        context: "Contexte",
        owner: "Responsable",
        due: "Échéance",
      },
      openIt: "Ouvrir : {url}",
      openInHub: "Ouvrir dans QBBE Hub",
      manage: "Gérer les préférences de courriel",
      manageText: "Gérer les préférences de courriel : {url}",
      sentTo: "Envoyé à {name} par {organization}.",
      digestSubjectOne: "1 mise à jour en attente dans QBBE Hub",
      digestSubjectOther: "{count} mises à jour en attente dans QBBE Hub",
      hello: "Bonjour {name},",
      waiting: "Voici ce qui vous attend.",
      more: "…et {count} de plus.",
      openInbox: "Ouvrir votre boîte de réception",
      openInboxText: "Ouvrir votre boîte de réception : {url}",
      digestFooter: "Résumé quotidien pour {name}, {organization}.",
    },
  },
  onboarding: {
    title: "Bienvenue",
    roles: {
      owner: "Propriétaire principal",
      admin: "Administrateur de l’espace de travail",
      staff: "Personnel",
      volunteer: "Bénévole",
      guest: "Invité en lecture seule",
    },
    steps: {
      profile: "Votre profil",
      notifications: "Notifications",
      integrations: "Intégrations",
      tour: "Vous orienter",
    },
    progress: "Progression de la configuration",
    stepOf: "Étape {step} sur {total}",
    profileIntro:
      "Votre nom et votre rôle apparaissent à côté de votre travail, de vos messages et de vos approbations dans tout le Hub.",
    fullName: "Nom complet",
    roleTitle: "Rôle ou titre",
    rolePlaceholder: "p. ex. Coordonnatrice de programme",
    accessLevel:
      "Votre niveau d’accès est {role} — seul un administrateur peut le modifier.",
    timeZone: "Fuseau horaire",
    timeZoneHint: "Les échéances et les heures de réunion s’affichent dans ce fuseau.",
    continue: "Continuer",
    notificationsIntro:
      "Vous pouvez modifier ces choix en tout temps. Les avis de sécurité critiques et les annonces obligatoires sont toujours livrés.",
    emailUrgent: "M’envoyer un courriel pour les éléments urgents",
    emailUrgentHint: "Affectations directes, mentions et annonces critiques.",
    dailyDigest: "Envoyer un résumé quotidien",
    dailyDigestHint:
      "Regrouper l’activité courante dans un seul résumé plutôt que dans des courriels séparés.",
    skip: "Passer",
    integrationsIntro:
      "Gmail et Google Agenda relient le Hub à votre boîte de courriel et à votre horaire. Ils sont facultatifs et peuvent être configurés plus tard par un administrateur.",
    googleTitle: "Gmail et Google Agenda",
    googleBody:
      "Nécessite des identifiants Google approuvés par QBBE. Tant qu’un administrateur ne les a pas configurés, ils restent déconnectés — le Hub fonctionne pleinement sans eux.",
    skipForNow: "Passer pour l’instant",
    tourIntro:
      "Voici où se trouvent les choses. Vous pouvez toujours appuyer sur {shortcut} pour rechercher ou aller n’importe où.",
    tour: {
      home: "Accueil",
      homeHint: "— ce qui demande votre attention aujourd’hui, et la santé du portefeuille.",
      myWork: "Mon travail",
      myWorkHint: "— tout ce qui vous est confié, regroupé par urgence.",
      channels: "Canaux",
      channelsHint: "— les conversations d’équipe qui restent près du travail.",
      announcements: "Annonces",
      announcementsHint: "— les avis officiels; certains exigent votre accusé de lecture.",
    },
    enter: "Entrer dans l’espace de travail",
    back: "← Retour",
    welcomeToast: "Bienvenue dans QBBE Hub, {name}.",
    errors: {
      finishFailed: "Impossible de terminer la configuration.",
      profileFailed: "Impossible d’enregistrer votre profil.",
      prefsFailed: "Impossible d’enregistrer les préférences.",
      nameRequired: "Indiquez-nous votre nom.",
      invalidInput: "Données non valides.",
      completeFailed: "Impossible de terminer la configuration.",
      invalidSetting: "Paramètre non valide.",
      settingFailed: "Impossible d’enregistrer le paramètre.",
      invalidDensity: "Densité non valide.",
    },
  },
  account: {
    inactive: {
      title: "Compte inactif",
      heading: "Ce compte est inactif",
      body: "Un administrateur a désactivé cette adhésion. Vous pouvez tout de même vous déconnecter. Demandez à un administrateur de l’espace de travail si vous avez besoin de rétablir votre accès.",
      signOut: "Se déconnecter",
      signOutFailed: "Impossible de vous déconnecter. Réessayez.",
    },
    errors: {
      adminRequired: "Accès administrateur requis.",
      ownerRequired: "Seul le propriétaire principal peut effectuer cette action.",
      mfaRequired:
        "Terminez l’authentification multifacteur avant d’effectuer cette action.",
      mfaUnavailable: "Impossible de vérifier l’authentification multifacteur. Réessayez.",
    },
  },
  privacy: {
    title: "Avis de confidentialité",
    linkLabel: "Avis de confidentialité",
    draftBanner:
      "Ébauche : le QBBE n’a pas encore approuvé cet avis. Il décrit le fonctionnement actuel du Hub et pourrait changer avant sa version définitive.",
    version: "Version {version}",
    intro:
      "QBBE Hub est l’espace de travail interne du Quebec Board of Black Educators (QBBE) pour son personnel, ses bénévoles, les membres de son conseil et ses invités. Cet avis explique quels renseignements personnels le Hub recueille, pourquoi, qui peut les consulter, où ils sont conservés et comment exercer vos droits.",
    collectHeading: "Ce que nous recueillons",
    collectBody:
      "Votre nom, votre adresse courriel, votre titre, votre photo, votre fuseau horaire et votre langue; ce que vous écrivez et téléversez dans le Hub (messages, tâches, commentaires, documents, formulaires, signatures); vos connexions et les dernières pages consultées. Pour les donateurs, bailleurs de fonds et partenaires inscrits au CRM : leurs coordonnées, des notes sur nos échanges et, pour les donateurs, leurs dons et les montants. Pour les employés : les montants de paie importés du fournisseur de paie.",
    whyHeading: "Pourquoi",
    whyBody:
      "Pour mener les activités de l’organisme, garder le lien avec les donateurs, bailleurs de fonds et partenaires, et tenir les registres financiers exigés par la loi. Nous ne vendons pas de renseignements personnels et ne les utilisons pas à des fins publicitaires.",
    whoHeading: "Qui peut les consulter",
    whoBody:
      "Seules les personnes dont le rôle l’exige. La base de données refuse l’accès à toute autre personne : les canaux privés et les messages directs ne sont visibles que par leurs membres, le CRM par le personnel, les registres financiers et la paie par les personnes autorisées aux finances, et les notes sensibles par leur responsable et les administrateurs. Les administrateurs doivent utiliser l’authentification à deux facteurs.",
    staffHeading: "Pour le personnel et les bénévoles",
    staffBody:
      "Le Hub conserve un historique de qui a modifié quoi dans les tâches, projets et documents. Si un administrateur active les signaux d’équipe, les responsables d’équipe voient des indicateurs par personne, comme les tâches en retard. Si vous connectez votre compte Google, le Hub lit les métadonnées des courriels et des événements d’agenda que vous choisissez de lier et peut envoyer des courriels en votre nom; vous pouvez le déconnecter en tout temps.",
    whereHeading: "Où ils sont conservés, et fournisseurs hors Québec",
    whereBody:
      "Les données du Hub sont conservées chez Supabase et servies à partir d’un serveur loué par le QBBE; les courriels sont envoyés par Resend; des sauvegardes chiffrées des données et des fichiers sont conservées dans le Google Drive du QBBE; votre propre boîte courriel et votre agenda Google ne sont utilisés que si vous les connectez; les rapports d’erreurs, s’ils sont activés, sont envoyés à Sentry. Certains de ces fournisseurs peuvent traiter des renseignements à l’extérieur du Québec. Le QBBE évalue chacun d’eux avant d’y faire appel.",
    keepHeading: "Combien de temps nous les conservons",
    keepBody:
      "Les registres financiers, y compris les dons et la paie, sont conservés six ans après la fin de l’exercice, comme l’exige la loi fiscale. Le journal d’audit des actions administratives est conservé au moins six ans. Les autres renseignements sont conservés tant qu’ils servent aux fins décrites ci-dessus; le QBBE établit encore la durée de conservation de certains d’entre eux, et cet avis l’indiquera une fois fixée.",
    rightsHeading: "Vos droits",
    rightsBody:
      "Vous pouvez demander à consulter les renseignements personnels que nous détenons à votre sujet, à les faire corriger ou à les faire supprimer lorsque nous n’avons plus à les conserver, et demander comment ils sont utilisés. Nous répondons dans un délai de 30 jours. Vous pouvez aussi porter plainte auprès de la Commission d’accès à l’information du Québec.",
    contactHeading: "Personne responsable de la protection des renseignements personnels",
    contactPending:
      "Le QBBE désigne actuellement cette personne. D’ici à ce que ses coordonnées soient publiées ici, écrivez au QBBE par votre contact habituel ou à un administrateur du Hub.",
    contactNamed: "{title}, {email}",
    linkInline: "avis de confidentialité",
    acknowledge: "En créant un compte, vous reconnaissez avoir pris connaissance de l’{link}.",
    onboardingNote: "En entrant dans l’espace de travail, vous reconnaissez avoir pris connaissance de l’{link}.",
    backToSignIn: "Retour à la connexion",
  },
};
