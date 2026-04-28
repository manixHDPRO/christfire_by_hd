# Cahier des charges — **HD by ChristFire**

**Application web** de gestion opérationnelle et commerciale d’un complexe de bungalows.  
**Identité** : nom commercial **HD by ChristFire**, aligné sur la charte visuelle **CHRIST-FIRE SARLU** (badge flamme, tons chauds et premium).

---

## 1. Contexte et objectifs

### 1.1 Contexte

Le client exploite un ensemble de bungalows classés en trois niveaux d’offre. L’outil doit centraliser l’inventaire, les réservations, l’accueil (check-in/out), la relation client et la facturation.

### 1.2 Objectifs business

- Maximiser le taux d’occupation et la visibilité temps réel sur les créneaux libres.
- Réduire les erreurs d’affectation et les doubles réservations.
- Accélérer l’encaissement et la production documentaire (factures, suivi des paiements).
- Offrir une expérience « haut de gamme » cohérente avec l’image de marque.

### 1.3 Objectifs produit

- Interface **moderne, intuitive, responsive**, avec **sidebar** de navigation et **tableau de bord** comme point d’entrée.
- **Micro-interactions** et **animations discrètes** (feedback UI, transitions, états de chargement) sans surcharger l’usage quotidien.

---

## 2. Périmètre fonctionnel

### 2.1 Référentiel bungalows

| Attribut | Règles |
|----------|--------|
| **Catégorie** | **Premium**, **Deluxe**, **Standard** (obligatoire) |
| **Nombre de pièces** | **1 ou 2** |
| **Capacité d’accueil** | **1, 2 ou 3** personnes |
| **Identifiant** | Code unique (ex. B-P-12), libellé marketing, description courte |
| **Médias** | Au moins une photo principale ; galerie optionnelle |
| **Équipements** | Liste structurée (Wi‑Fi, climatisation, kitchenette, etc.) |
| **Statut opérationnel** | Disponible, en maintenance, hors service, etc. (à préciser en atelier) |

**Code couleur (UI)**

- **Premium** : tons « luxe » — fond / bordures inspirés du **rouge profond** du logo, textes et accents **blanc** ou crème très contrastés.
- **Deluxe** : **orange vif** / chaud (milieu de flamme) pour accents, badges, états « mis en avant ».
- **Standard** : **crème / jaune pâle** + **gris neutre** pour fonds secondaires et lisibilité.

Référence palette indicative issue du logo : rouge brand `#911915`, crème `#FFF7D6`, orange `#F9A825`, rouge-orange `#E64A19`, blanc `#FFFFFF`.

### 2.2 Dashboard intelligent

- **Synthèse d’occupation** : période sélectionnable (jour / semaine / mois / plage personnalisée), taux global et par catégorie.
- **Statistiques** : revenus (période), **réservations actives**, **disponibilité** (nombre de nuitées ou de créneaux restants selon le modèle métier).
- **Indicateurs visuels** : graphiques (occupation, revenus, répartition par catégorie), **cartes** (vue d’ensemble type « heat » ou carte du site si géolocalisation disponible — à trancher : plan du complexe vs carte réelle).
- **Alertes** : réservations à venir, check-in du jour, impayés, capacité critique (forte demande / faible stock).

### 2.3 Gestion des bungalows

- **Liste filtrable** : catégorie, capacité, disponibilité (à une date ou sur une plage), recherche texte.
- **Fiche détaillée** : photos, équipements, statut, historique récent des séjours (lien vers réservations).
- Cohérence visuelle des **badges** et **bordures** par catégorie (Premium / Deluxe / Standard).

### 2.4 Système de réservation

- **Calendrier interactif** avec **glisser-déposer** pour déplacer / étendre un séjour (avec règles de validation : disponibilité, capacité, chevauchement).
- **Check-in / check-out** : dates et heures, statuts (confirmé, en cours, terminé, no-show — à valider).
- **Attribution bungalow** :
  - **Manuelle** : choix explicite par l’opérateur.
  - **Automatique** : proposition selon catégorie demandée, capacité, disponibilité et règles de priorité (ex. optimiser l’occupation, préférence client si enregistrée).

### 2.5 Gestion clients

- **Fiche client** : coordonnées, pièces d’identité / documents (si légal et utile), notes internes.
- **Historique** : réservations passées et à venir, montants, incidents / préférences (ex. étage, bungalow calme).
- **Suivi des séjours** : lien réservation ↔ bungalow ↔ facturation.

### 2.6 Paiement et facturation

- **Génération de factures** : modèle PDF (en-tête ChristFire / HD), lignes (hébergement, taxes, extras), numérotation, mentions légales SARLU à intégrer selon le conseil du client.
- **Suivi des paiements** : statuts (en attente, partiel, payé, remboursé), échéancier si acomptes, historique des transactions (manuel au minimum ; intégration prestataire de paiement = phase 2 possible).

---

## 3. Expérience utilisateur (UX/UI)

### 3.1 Principes

- **Élégant et minimaliste** : hiérarchie claire, beaucoup d’espace blanc sur la zone de contenu, sidebar structurelle.
- **Responsive** : usage bureau prioritaire pour le back-office ; tablette acceptable pour le terrain (check-in).
- **Navigation** : sidebar persistante, fil d’Ariane sur les écrans profonds, raccourcis depuis le dashboard.

### 3.2 Typographie (alignement logo)

- **Titres principaux** : style **slab serif** fort, capitales possibles pour l’identité « HD by ChristFire ».
- **Interface** (menus, tableaux, formulaires) : **sans-serif** moderne, lisible, petites capitales possibles pour les labels secondaires.

### 3.3 Micro-interactions

- Animations courtes sur hover/focus, validation de formulaire, succès d’enregistrement.
- États de chargement skeleton sur listes et graphiques.
- Retour visuel sur drag & drop du calendrier (zone valide / invalide).

### 3.4 Accessibilité (cible recommandée)

- Contrastes suffisants (rouge foncé + texte blanc validé sur composants interactifs).
- Navigation clavier sur calendrier et formulaires ; attributs ARIA sur composants riches.

---

## 4. Exigences non fonctionnelles

- **Performance** : temps de chargement dashboard < 3 s sur connexion standard cible ; listes paginées ou virtualisées.
- **Sécurité** : authentification, rôles (admin, réception, compta — à affiner), journalisation des actions sensibles (annulation, modification de tarif, etc.).
- **Fiabilité** : aucune double réservation sur le même bungalow aux mêmes dates (contrainte d’intégrité côté serveur).
- **Sauvegarde** : stratégie de sauvegarde base de données et restauration (à définir avec l’hébergeur).
- **Évolutivité** : tarification dynamique, saisons, packs — hors périmètre V1 possible mais architecture ouverte.

---

## 5. Acteurs et droits (proposition)

| Rôle | Usage typique |
|------|----------------|
| **Administrateur** | Bungalows, utilisateurs, paramètres, tarifs |
| **Réception / exploitation** | Réservations, calendrier, check-in/out |
| **Commercial / direction** | Dashboard, stats, export |
| **Comptabilité** | Factures, paiements, exports comptables |

---

## 6. Intégrations et données (à valider en atelier)

- Export CSV/Excel des réservations et paiements.
- Envoi d’e-mails (confirmation, relance paiement) — optionnel V1.
- Hébergement : cloud managé ou serveur dédié ; base relationnelle recommandée pour contraintes de réservation.

---

## 7. Livrables attendus

1. Maquettes UX/UI (mobile + desktop) validées.
2. Application web déployée (environnements recette / production).
3. Base de données et API documentées.
4. Manuel utilisateur court par rôle.
5. Jeux de tests sur scénarios critiques (réservation, conflit de dates, facturation).

---

## 8. Jalons de projet (suggestion)

1. **Cadrage** : règles métier détaillées (tarifs, taxes, politique d’annulation).
2. **MVP** : bungalows + réservations + calendrier + clients + factures / paiements manuels.
3. **V1 complète** : dashboard analytique avancé, automatisation d’affectation, exports, raffinements UX.
4. **Durcissement** : perf, sécurité, accessibilité, formation.

---

*Document rédigé pour servir de base au projet HD by ChristFire. Les points « à valider » doivent être complétés en atelier (tarification, mentions légales factures, intégration paiement en ligne).*
