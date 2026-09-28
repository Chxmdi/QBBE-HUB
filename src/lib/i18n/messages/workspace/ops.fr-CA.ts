import type { opsEn } from "./ops.en";

/** Français québécois — jobs, retention, records (#141). À faire réviser. */
export const opsFrCA: typeof opsEn = {
  jobs: {
    runner: {
      command: "select app.configure_job_runner('<adresse de ce site>', '<CRON_JOB_SECRET>');",
      title: "Les tâches planifiées ne s’exécutent pas",
      fix: {
        not_configured: "Les tâches planifiées ne sont pas reliées à ce site : les fichiers téléversés ne passent jamais leur contrôle de sécurité et aucun courriel d’avis n’est envoyé. Dans l’éditeur SQL de Supabase, exécutez :",
        other_site: "Les tâches planifiées sont reliées à une autre adresse que celle de ce site. Exécutez de nouveau app.configure_job_runner avec l’adresse de ce site.",
        secret_mismatch: "Le secret des tâches enregistré dans la base de données ne correspond pas au CRON_JOB_SECRET de ce site : chaque appel de tâche est donc refusé. Exécutez de nouveau app.configure_job_runner avec le secret actuel du site.",
        app_secret_missing: "Ce site n’a pas de CRON_JOB_SECRET : il refuse donc chaque appel de tâche. Ajoutez-le dans les paramètres de l’hébergement (au moins 32 caractères), puis redéployez.",
        unknown: "L’état de l’exécuteur de tâches n’a pas pu être lu. Vérifiez que SUPABASE_SERVICE_ROLE_KEY est défini pour ce site.",
      },
    },
    title: "Tâches planifiées",
    unconfiguredLead: "Aucune tâche n’a encore été exécutée.",
    unconfiguredBefore:
      "Le planificateur n’atteint ce déploiement qu’après qu’un administrateur a exécuté",
    unconfiguredAfter: "sur la base de données. Voir docs/runbooks/jobs.md.",
    failuresHeading: "Échecs récents",
    failuresEmpty:
      "Aucune exécution n’a laissé de travail de côté. Les échecs s’affichent ici avec l’erreur qui les a causés.",
    queuesHeading: "Files d’attente",
    queueError: "Impossible de lire les mesures des files d’attente : {error}",
    noQueuesTitle: "Aucune file d’attente",
    noQueuesDescription:
      "Les files d’attente sont créées par la migration 0008. Si aucune n’apparaît, les migrations n’ont pas été appliquées à cette base de données.",
    columns: {
      queue: "File",
      pending: "En attente",
      readyNow: "Prêts maintenant",
      oldest: "Plus ancien",
      deadLetters: "Messages en échec",
      job: "Tâche",
      schedule: "Horaire",
      lastRun: "Dernière exécution",
      nextRun: "Prochaine exécution",
      failures24h: "Échecs (24 h)",
    },
    deadLettered: "Messages mis de côté ({count})",
    attemptsOne: "{count} tentative",
    attemptsOther: "{count} tentatives",
    archived: "archivé {when}",
    scheduleHeading: "Tâches planifiées",
    disabled: "désactivée",
    processed: "{count} traités",
    failedSuffix: ", {count} en échec",
    utcNote:
      "Les horaires et les prochaines exécutions sont en UTC, comme dans pg_cron.",
    units: {
      ms: "{n} ms",
      s: "{n} s",
      ageSeconds: "{n} s",
      ageMinutes: "{n} min",
      ageHours: "{n} h",
    },
    run: {
      never: "Jamais exécutée",
      running: "En cours",
      succeeded: "Réussie",
      failed: "Échouée",
      partial: "{count} en échec",
    },
    schedule: {
      everyMinute: "Chaque minute",
      everyNMinutes: "Toutes les {n} minutes",
      hourly: "Toutes les heures",
      daily: "Tous les jours à {times} UTC",
      onDays: "{days} à {times} UTC",
      weekdays: "En semaine",
      time: "{h} h {m}",
      days: {
        "0": "Dimanche",
        "1": "Lundi",
        "2": "Mardi",
        "3": "Mercredi",
        "4": "Jeudi",
        "5": "Vendredi",
        "6": "Samedi",
      },
    },
    descriptions: {
      "team-signal-reminders":
        "Rappelle avec bienveillance au personnel le travail qui requiert son attention, une fois par signal, là où les rappels sont activés.",
      "team-signal-digest":
        "Envoie chaque semaine aux propriétaires et aux administrateurs la liste des personnes ayant un signal de travail ouvert, là où le résumé est activé.",
      "drain-notifications":
        "Envoie les courriels de notification en attente et consigne chaque tentative.",
      "retry-failed-emails":
        "Récupère les envois laissés en suspens par une exécution interrompue et relance les échecs passagers avec un délai croissant.",
      "daily-digest":
        "Prépare et met en file le résumé des notifications non lues de chaque personne, à sa propre heure locale de résumé.",
      "announcement-nudge":
        "Relance les personnes qui n’ont pas encore confirmé la lecture d’une annonce obligatoire.",
      "due-date-reminders":
        "Avise les responsables des tâches dues aujourd’hui, dues demain ou en retard.",
      "stale-project-sweep":
        "Signale à leur responsable les projets actifs sans activité depuis quatorze jours.",
      "purge-job-history":
        "Élague l’historique job_run et les messages de file archivés au-delà de leur durée de conservation.",
      "scheduled-announcements":
        "Diffuse les notifications des annonces dont l’heure de publication est arrivée.",
      "google-sync":
        "Récupère les métadonnées Gmail, le calendrier superposé et les liens Drive de chaque compte connecté.",
      "gmail-watch-renew":
        "Renouvelle les abonnements aux notifications Gmail un jour avant leur expiration.",
      "vms-sync":
        "Met à jour la disponibilité des bénévoles à partir du système de gestion des bénévoles (VMS).",
      "run-exports":
        "Produit les exportations de données en attente et les dépose dans l’espace de stockage privé des exportations.",
      "expire-exports":
        "Fait expirer les exportations échues et supprime les fichiers correspondants.",
      "apply-retention":
        "Applique les politiques de conservation activées et consigne ce que chacune a supprimé.",
      "scan-documents":
        "Analyse les fichiers téléversés en quarantaine avec le service ClamAV privé.",
      "gmail-push-sync":
        "Rapproche l’historique Gmail dès réception d’une notification Pub/Sub authentifiée.",
      "retry-workflow-executions":
        "Relance les notifications de flux de travail qui n’ont pas pu être enregistrées, sans renvoyer celles qui l’ont été.",
      "scan-receipts":
        "Analyse les reçus téléversés en quarantaine avec le service ClamAV privé.",
      "report-record-retention":
        "Signale les dossiers classés dont la période de conservation est terminée. Ne supprime rien.",
      "scan-form-files":
        "Analyse les pièces jointes des formulaires et les documents à signer avec le service ClamAV privé, et enregistre l’empreinte SHA-256 de chaque fichier.",
      "grant-report-reminders":
        "Rappelle aux responsables des rapports de subvention leur échéance, avant, le jour même et après la date prévue.",
    },
    email: {
      fallbackName: "à vous",
    },
    notify: {
      labelled: "{label} : {title}",
      overdue: "En retard",
      dueToday: "Échéance aujourd’hui",
      dueTomorrow: "Échéance demain",
      comingUp: "À venir",
      taskOverdueBody:
        "L’échéance était le {date}. Modifiez la date d’échéance ou faites avancer le travail.",
      dueBody: "Échéance : {date}.",
      followUpOverdue: "Suivi en retard",
      followUpDue: "Suivi à faire",
      grantTitle: "{label} : {report} pour {grant}",
      aGrant: "une subvention",
      grantOverdueBody:
        "Ce rapport de subvention était dû le {date}. Transmettez-le au bailleur de fonds, puis indiquez qu’il a été soumis.",
      grantDueBody: "Rapport de subvention dû le {date}.",
      ackTitle: "Confirmation de lecture requise : {title}",
      ackBy: "Confirmez la lecture d’ici le {date}.",
      ackOpen: "Ouvrez l’annonce et confirmez-en la lecture.",
      announcementTitle: "Annonce : {title}",
      staleTitle: "Mise à jour de l’état attendue : {name}",
      staleBody:
        "Ce projet fait l’objet d’un compte rendu {cadence}. La dernière mise à jour de l’état date de plus de {days} jours.",
      cadenceWeekly: "hebdomadaire",
      cadenceMonthly: "mensuel",
      teamSignalTitle: "Une partie de votre travail mérite peut-être un coup d’œil",
      teamSignalBody:
        "{reasons}. Votre résumé de travail donne les détails. Ce rappel n’est envoyé qu’une fois et ne se répète pas tant que la situation reste la même.",
    },
    teamDigest: {
      subjectOne: "Signaux d’équipe : 1 personne a du travail qui requiert votre attention",
      subjectOther: "Signaux d’équipe : {count} personnes ont du travail qui requiert votre attention",
      intro:
        "Ces personnes ont au moins un signal de travail ouvert cette semaine. Chaque ligne est un fait tiré de leurs dossiers de travail, pas un jugement.",
      openSummary: "Ouvrir le résumé de travail",
      openOverview: "Ouvrir la vue d’ensemble de l’équipe",
      footer:
        "Vous recevez ce message parce que vous êtes propriétaire ou administrateur de {organization} et que le résumé hebdomadaire de l’équipe est activé dans Administration, Signaux d’équipe.",
    },
  },
  retention: {
    title: "Conservation",
    eyebrow: "Administration",
    description:
      "Durée de conservation de chaque type de dossier. Les politiques sont désactivées tant que vous ne les activez pas, et chacune indique ce qu’elle supprimerait avant de supprimer quoi que ce soit.",
    enabledBadge: "{duration}, puis {outcome}",
    outcomeDeleted: "supprimés",
    outcomeRedacted: "caviardés",
    setNotOn: "Définie, mais non activée",
    keptIndefinitely: "Conservés indéfiniment",
    floor: "Minimum : {duration}",
    or: " ou ",
    wouldAffect: "{count} enregistrements datent déjà de plus de {duration}.",
    nothingOlder: "Rien ne date encore de plus de {duration}.",
    lastRun: "Dernière exécution {when}",
    lastAffected: ", {count} touchés",
    runsHeading: "Ce qui a été supprimé",
    runsEmpty:
      "Rien pour l’instant. Chaque passage est consigné ici, y compris ceux qui n’ont rien supprimé : une suppression dont il ne reste aucune trace ne se distingue pas d’une perte de données.",
    runFailed: "Échec",
    runAffected: "{count} touchés",
    runCutoff: "Tout ce qui précède le {date}, par {method}.",
    methodDeletion: "suppression",
    methodRedaction: "caviardage",
    footer:
      "Seuls les types de dossiers ci-dessus peuvent être encadrés. En ajouter un autre exige volontairement une modification du schéma : un système de conservation qui peut viser n’importe quelle table est une faille de conformité qui n’attend qu’un administrateur bien intentionné.",
    actions: {
      delete: "Supprimer les enregistrements",
      anonymise: "Garder l’enregistrement, retirer le contenu",
    },
    duration: {
      dayOne: "{n} jour",
      dayOther: "{n} jours",
      monthOne: "{n} mois",
      monthOther: "{n} mois",
      yearOne: "{n} an",
      yearOther: "{n} ans",
    },
    errors: {
      mustKeep: "{label} : la conservation doit être d’au moins {duration}.",
      cannotAnonymise: "{label} : l’anonymisation n’est pas permise.",
      cannotDelete: "{label} : la suppression n’est pas permise.",
      enterDays: "Entrez un nombre de jours.",
      wholeDays: "Entrez un nombre entier de jours.",
      atLeastDay: "La conservation doit être d’au moins un jour.",
      notGovernable: "Ce type de dossier ne peut pas être encadré par une politique.",
      invalidInput: "Données non valides.",
      generic: "Cela n’a pas fonctionné. Réessayez.",
    },
    editor: {
      change: "Modifier",
      setPolicy: "Définir une politique",
      confirm:
        "Une fois activée, cette politique va {verb} {count} enregistrements de type « {label} » lors du prochain passage nocturne, puis d’autres à mesure qu’ils dépasseront {duration}. Continuer?",
      verbDelete: "supprimer définitivement",
      verbRedact: "caviarder",
      keepForDays: "Conserver pendant (jours)",
      atLeast: "Au moins {duration}.",
      thatIs: " Soit {duration}.",
      whatHappens: "Ce qui se passe",
      why: "Pourquoi (facultatif)",
      applyNightly: "Appliquer chaque nuit",
      save: "Enregistrer",
      cancel: "Annuler",
    },
    subjects: {
      activity_event: {
        label: "Fil d’activité",
        description:
          "Qui a fait quoi, affiché dans la chronologie des projets et des programmes. Du bruit opérationnel une fois ancien.",
        caution:
          "La chronologie des projets perd ses entrées les plus anciennes. Rien d’autre n’en dépend.",
      },
      notification: {
        label: "Notifications",
        description:
          "Alertes dans l’application. Une fois lues et anciennes, elles ne servent plus à personne.",
        caution: "Ne touche que le menu des notifications et son historique.",
      },
      crm_interaction: {
        label: "Notes d’interaction CRM",
        description:
          "Rencontres, appels et notes consignés pour un bailleur de fonds ou un partenaire.",
        caution:
          "La continuité des relations en dépend. L’anonymisation garde la trace du contact et retire ce qui a été dit.",
      },
      export_job: {
        label: "Registre des exportations",
        description:
          "Le journal de qui a exporté quoi. Les fichiers sont supprimés après sept jours de toute façon; ceci en est la trace.",
        caution:
          "C’est la réponse à la question « qui a pris une copie ». Conservez-le plus longtemps que vous ne le pensez nécessaire.",
      },
      audit_event: {
        label: "Journal d’audit",
        description:
          "Actions administratives : changements de rôle, approbations, exportations, connexions.",
        caution:
          "Le minimum de six ans est voulu. Les dossiers des organismes de bienfaisance doivent souvent être conservés aussi longtemps, et le journal d’audit est la première chose qu’une enquête demande.",
      },
    },
  },
  records: {
    title: "Dossiers et suspensions",
    eyebrow: "Administration",
    description:
      "Durée de conservation de chaque type de dossier d’affaires, et suspensions pour motif juridique qui empêchent la suppression. Les dossiers classés ne peuvent être supprimés avant leur date de fin de conservation ni pendant une suspension — par personne.",
    notClassified: "Non classé",
    aDocument: "Un document",
    yearEndHeading: "Fin d’exercice",
    yearEndSet: "Les dossiers financiers sont comptés à partir du {day} {month}.",
    yearEndUnset:
      "Non définie. D’ici là, le Hub compte à partir d’un an après la date de chaque dossier, ce qui ne peut que prolonger la conservation.",
    rulesHeading: "Règles de conservation",
    confirmedBy: "Confirmé par le {who}",
    needsConfirmation: "Confirmation du {who} requise",
    who: {
      accountant: "comptable",
      counsel: "conseiller juridique",
    },
    note: "Note : {note}",
    holdsHeading: "Suspensions pour motif juridique",
    noHolds: "Aucune suspension active.",
    wholeCategory: "Toute la catégorie « {category} »",
    placed: "Imposée {when}",
    classifyHeading: "Classer un document",
    classifyHelp:
      "La date du dossier est celle à laquelle il se rapporte : l’achat, le relevé ou la fin d’un contrat. Laissée vide, la date d’ajout du document est utilisée. Un classement ne peut pas être modifié de façon à raccourcir la durée de conservation obligatoire.",
    registerHeading: "Registre des dossiers",
    lastCheck:
      "Dernière vérification nocturne {when} : {past} au-delà de la conservation, {held} suspendus.",
    notRunYet: "La vérification nocturne n’a pas encore eu lieu.",
    pastOne:
      "{count} dossier a atteint la fin de sa période de conservation et peut maintenant être éliminé. Rien n’est supprimé automatiquement.",
    pastOther:
      "{count} dossiers ont atteint la fin de leur période de conservation et peuvent maintenant être éliminés. Rien n’est supprimé automatiquement.",
    nonePast: "Aucun dossier n’a atteint la fin de sa période de conservation.",
    registerEmpty: "Aucun document n’est encore classé ni suspendu.",
    onHold: "Suspendu",
    pastRetention: "Conservation échue",
    registerMeta: "{category} · daté du {date} · fin de conservation\u00a0: {until}",
    months: {
      "1": "janvier",
      "2": "février",
      "3": "mars",
      "4": "avril",
      "5": "mai",
      "6": "juin",
      "7": "juillet",
      "8": "août",
      "9": "septembre",
      "10": "octobre",
      "11": "novembre",
      "12": "décembre",
    },
    period: {
      permanent: "Conservé en permanence",
      fiscalOne: "{n} an après la fin de l’exercice",
      fiscalOther: "{n} ans après la fin de l’exercice",
      recordOne: "{n} an après la date du dossier",
      recordOther: "{n} ans après la date du dossier",
    },
    retainUntil: {
      noRule: "aucune règle",
      permanently: "jamais",
    },
    errors: {
      enterYears: "Entrez un nombre d’années.",
      wholeYears: "Entrez un nombre entier d’années.",
      atLeastYear: "Entrez au moins un an.",
      atMost100: "Entrez 100 ans ou moins.",
      chooseCategory: "Choisissez une catégorie de dossiers.",
      chooseMonth: "Choisissez un mois.",
      chooseDay: "Choisissez un jour.",
      noSuchDay: "Ce jour n’existe pas dans ce mois (le 29 février n’est pas accepté).",
      holdReason: "Indiquez pourquoi la suspension est nécessaire.",
      releaseReason: "Indiquez pourquoi la suspension est levée.",
      chooseDocument: "Choisissez un document.",
      dateFormat: "Entrez la date au format AAAA-MM-JJ.",
      invalidInput: "Données non valides.",
      yearEndNotSaved: "La fin d’exercice n’a pas pu être enregistrée.",
      holdNotActive: "Cette suspension n’est plus active.",
      documentNotFound: "Ce document est introuvable.",
      generic: "Cela n’a pas fonctionné. Réessayez.",
    },
    forms: {
      changeOrConfirm: "Modifier ou confirmer",
      keepForYears: "Conserver pendant (années)",
      atLeastYears: "Au moins {n} ans.",
      confirmationNote: "Note de confirmation (facultatif)",
      notePlaceholder: "p. ex. Confirmé par le {who} par courriel le …",
      hasConfirmed: "Le {who} a confirmé cette période",
      save: "Enregistrer",
      cancel: "Annuler",
      month: "Mois",
      day: "Jour",
      saveYearEnd: "Enregistrer la fin d’exercice",
      hold: "Suspension",
      oneDocument: "Un document",
      wholeCategory: "Une catégorie de dossiers entière",
      category: "Catégorie",
      document: "Document",
      choose: "Choisir…",
      reason: "Motif",
      reasonPlaceholder: "p. ex. Vérification de Revenu Québec de l’exercice 2025",
      placeHold: "Imposer la suspension",
      release: "Lever",
      releaseWhy: "Pourquoi la suspension est-elle levée?",
      releaseHold: "Lever la suspension",
      notBusinessRecord: "Pas un dossier d’affaires",
      recordDate: "Date du dossier",
      saveClassification: "Enregistrer le classement",
    },
    categories: {
      financial_record: {
        label: "Dossiers financiers",
        description:
          "Livres comptables, grands livres, journaux, états de fin d’exercice et documents de travail connexes.",
        legalReference:
          "Loi de l’impôt sur le revenu, art. 230 (ARC); Loi sur l’administration fiscale, art. 35.2 (Revenu Québec); Loi sur la taxe d’accise, art. 286 (TPS/TVH). Six ans après la fin de la dernière année d’imposition à laquelle les dossiers se rapportent.",
      },
      receipt: {
        label: "Reçus",
        description: "Reçus d’achat et autres pièces justificatives de dépenses.",
        legalReference:
          "Mêmes règles que les dossiers financiers : six ans après la fin de l’année d’imposition à laquelle le reçu se rapporte. Les demandes de crédits de taxe sur les intrants (TPS et TVQ) exigent aussi le reçu.",
      },
      bill: {
        label: "Factures",
        description: "Factures de fournisseurs et factures reçues ou émises par l’organisme.",
        legalReference:
          "Mêmes règles que les dossiers financiers : six ans après la fin de l’année d’imposition à laquelle la facture se rapporte.",
      },
      bank_statement: {
        label: "Relevés bancaires",
        description:
          "Relevés bancaires et de cartes de crédit, bordereaux de dépôt et rapprochements.",
        legalReference:
          "Mêmes règles que les dossiers financiers : six ans après la fin de l’année d’imposition à laquelle le relevé se rapporte.",
      },
      contract: {
        label: "Contrats",
        description:
          "Baux, contrats de service, ententes de financement et autres contrats. Utilisez la date de fin du contrat comme date du dossier.",
        legalReference:
          "Les contrats qui appuient la comptabilité suivent la règle fiscale de six ans. Au Québec, les recours civils se prescrivent généralement par 3 ans (Code civil, art. 2925); à faire confirmer par le conseiller juridique.",
      },
      signed_document: {
        label: "Documents signés",
        description:
          "Formulaires de consentement, ententes de bénévolat, décharges et autres documents signés.",
        legalReference:
          "Code civil du Québec, art. 2925 (prescription de 3 ans) comme minimum. Les documents concernant des mineurs peuvent exiger plus longtemps; à faire confirmer par le conseiller juridique.",
      },
      form_submission: {
        label: "Formulaires soumis",
        description:
          "Formulaires d’accueil, d’inscription et de déclaration d’incident soumis dans le Hub.",
        legalReference:
          "Aucune période légale unique. Les rapports d’incident peuvent exiger plus longtemps; à faire confirmer par le conseiller juridique.",
      },
      governance_record: {
        label: "Documents de gouvernance",
        description:
          "Lettres patentes, règlements généraux, procès-verbaux du conseil et des assemblées générales, et résolutions.",
        legalReference:
          "L’ARC s’attend à ce qu’ils soient conservés jusqu’à deux ans après la dissolution de l’organisme; le Hub les conserve en permanence.",
      },
    },
  },
};
