# Plan — Stocks, achats, inventaire et coûts (Christ-Fire / site touristique CF)

Document de **cadrage avant implémentation** : périmètre fonctionnel, organisation physique du site, principes de données et pistes de phasage. À faire évoluer après ateliers métier.

---

## 1. Contexte opérationnel

### 1.1 Site unique, plusieurs points de vente

- **Une seule concession** : site touristique Christ-Fire (CF).
- **Trois terrasses**, chacune avec sa **caisse** :
  - **Terrasse 1** : restaurant + **caissière principale** (point d’encaissement de référence).
  - **Terrasse piscine** : caisse dédiée.
  - **Terrasse Padel** : caisse dédiée.
- Les **ventes au comptoir** doivent pouvoir être **attribuées au bon point de vente** pour les rapports (CA, marges par lieu, clôtures).

### 1.2 Stockage et flux marchandises

- **Un dépôt de stockage central** : seul point de **réception des achats** fournisseurs (entrées « officielles » de marchandises).
- **Transferts internes** depuis ce dépôt vers :
  - les **terrasses** (consommation / vente sur place) ;
  - le **restaurant** (cuisine / réserve de service — selon la granularité retenue).
- Les **transferts ne créent ni ne détruisent** de stock au niveau **site** : ils **déplacent** des quantités entre **emplacements** (dépôt ↔ terrasses / restaurant).

---

## 2. Périmètre fonctionnel cible

| Domaine | Description |
|--------|-------------|
| **Référentiels** | Fournisseurs, articles (SKU), unités, éventuellement familles (boissons, épicerie, linge, etc.). |
| **Achats** | Commandes fournisseurs, réception au **dépôt central**, écarts quantité / qualité, historique des prix d’achat. |
| **Stocks par lieu** | Niveaux de stock **par emplacement** : dépôt + chaque terrasse + zone restaurant (voir granularité §5.2). |
| **Transferts** | Bons de transfert dépôt → lieu ; confirmation de réception côté terrasse / resto si le processus le prévoit. |
| **Inventaire** | Comptages périodiques par lieu, écarts, motifs (casse, vol, erreur, dégustation, etc.). |
| **Coûts** | Valorisation des stocks (ex. **CMP** — coût moyen pondéré — en première approche), coût des ventes, marge par lieu ou par famille. |
| **Lien ventes** | Ventes POS **déstockant** les articles concernés sur **l’emplacement** où le produit est disponible (après transfert). |

### 2.1 Modules « métier » activables

À traiter comme **familles d’articles** ou **sous-périmètres**, pas comme trois applications séparées :

- **Restaurant** : sorties cuisine, éventuellement fiches techniques / nomenclatures (phasage possible).
- **Minibar** : souvent lié aux **unités d’hébergement** (bungalows) ; inventaire au départ/arrivée ou consommation déclarée.
- **Linge** : flux buanderie (réception, lavage interne ou prestataire, redistribution) ; coût au lit ou au kg selon le modèle réel.

---

## 3. Principes d’architecture données (conceptuel)

### 3.1 Hiérarchie logique

1. **Site** (Christ-Fire / CF) — une entité dans l’app.
2. **Emplacements** (`stock_locations`) : dépôt central, terrasses, restaurant/cuisine, etc.
3. **Points de vente** (`points_of_sale` ou équivalent) : les **3 caisses** + règles métier (caissière principale sur terrasse 1).
4. **Articles** + **stock par (article, emplacement)**.
5. **Mouvements de stock** typés, traçables (utilisateur, date, document lié).

### 3.2 Types de mouvements (exemples)

- Réception fournisseur (entrée **dépôt**).
- Transfert : sortie dépôt / entrée terrasse ou restaurant.
- Vente (liée à une ligne de vente / ticket POS et au **POS** concerné).
- Ajustement inventaire (écarts de comptage).
- (Éventuellement) retour fournisseur, casse, dégustation — selon besoin de finesse.

### 3.3 Caisse et stock

- Chaque **vente** enregistrée au POS doit porter un identifiant **point de vente** pour reporting et clôtures.
- Le **stock** consommé est sur **l’emplacement** où la marchandise se trouve **après** les transferts depuis le dépôt.

### 3.4 Rôles et contrôle

- **Caissière principale** : périmètre élargi possible (validations, annulations, clôtures, selon règles à définir).
- **Dépôt** : émission des transferts sortants ; les lieux **confirment la réception** si vous voulez réduire les écarts « en route ».
- Journalisation / audit pour opérations sensibles (alignement avec l’existant « audit » de l’application).

---

## 4. Cohérence avec l’application actuelle (constat)

- Les ventes comptoir existent (`counter_sales`) **sans** rattachement explicite à une terrasse / POS : **évolution structurante** = référentiel des **points de vente** + clé sur les ventes.
- Le taux de change / devises est déjà géré côté app : à réutiliser pour achats ou valorisation si achats en USD et compta en CDF (règle métier à figer).

---

## 5. Décisions à trancher avant ou pendant l’implémentation

### 5.1 Minibar

- Inventaire **systématique** départ / arrivée client, ou **déclaratif** uniquement ?
- Stock minibar : **par bungalow** comme emplacement, ou **regroupé** avec un seul lieu « minibar » ?

### 5.2 Restaurant

- Un seul emplacement **« Restaurant »** ou séparation **cuisine / bar terrasse 1** ?
- Fiches techniques dès le MVP ou **phase2** (achats + transferts + sorties manuelles / semi-auto au début) ?

### 5.3 Inventaire et fréquence

- Inventaire **tournant** par lieu vs **général** périodique ; responsables par zone.

### 5.4 Valorisation

- **CMP** simple en v1 ; règles si mélange USD/CDF sur factures fournisseurs.

---

## 6. Phasage d’implémentation suggéré

| Phase | Contenu |
|-------|---------|
| **P0** | Référentiel **points de vente** (3 terrasses + métadonnées) ; migration des ventes existantes avec POS par défaut si besoin ; permissions de base. |
| **P1** | Emplacements de stock (dépôt + lieux) ; articles ; **stock par lieu** ; **transferts** dépôt → terrasses / restaurant ; écrans ou API minimales. |
| **P2** | Fournisseurs ; **commandes** ; **réceptions** au dépôt ; historique prix ; CMP. |
| **P3** | **Inventaire** (comptages, écarts) ; rapports coûts / marges par POS et par famille. |
| **P4** | Minibar (par bungalow si retenu) ; linge / buanderie ; restaurant avancé (nomenclatures) selon priorité métier. |

Ordre ajustable : certains préfèrent **P2 avant** les transferts si les achats sont le goulot ;ici l’ordre privilégie la **cohérence des lieux** et des flux internes après avoir posé les **POS**.

---

## 7. Livrables de conception suivants (hors ce document)

- Schéma relationnel détaillé (tables SQLite : lieux, POS, articles, `stock_balances` ou mouvements agrégés, lignes de transfert, commandes, réceptions).
- Maquettes ou flux UI : création transfert, réception, inventaire, commande fournisseur.
- Matrice des **permissions** (qui crée un transfert, qui valide, qui compte le stock).

---

## 8. Historique du document

| Date | Auteur / source | Changement |
|------|-----------------|------------|
| 2026-04-15 | Atelier + assistant | Création : site unique, 3 terrasses + caissière principale, dépôt central, transferts vers terrasses et restaurant, modules resto / minibar / linge, phasage P0–P4. |
