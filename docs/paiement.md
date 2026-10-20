# Paiement Stripe : cartes de test

Ces cartes ne marchent qu'en **mode test**, avec une clé `sk_test_…`. Aucun débit réel.

Pour toutes les cartes :

| Champ | Valeur |
| --- | --- |
| Date d'expiration | n'importe quelle date future, par ex. `12/34` |
| CVC | 3 chiffres quelconques, par ex. `123` (4 pour American Express) |
| Nom, email, code postal | n'importe quelle valeur |

## Paiement accepté

| Numéro | Carte |
| --- | --- |
| `4242 4242 4242 4242` | Visa (celle à utiliser par défaut) |
| `5555 5555 5555 4444` | Mastercard |
| `3782 822463 10005` | American Express (CVC à 4 chiffres) |

## Paiement avec authentification 3D Secure

| Numéro | Comportement |
| --- | --- |
| `4000 0025 0000 3155` | Stripe affiche une fenêtre de validation : cliquer sur **Complete** accepte le paiement, **Fail** le refuse |

## Paiement refusé

| Numéro | Motif du refus |
| --- | --- |
| `4000 0000 0000 0002` | Refus générique (`card_declined`) |
| `4000 0000 0000 9995` | Fonds insuffisants (`insufficient_funds`) |
| `4000 0000 0000 9987` | Carte déclarée perdue (`lost_card`) |
| `4000 0000 0000 9979` | Carte déclarée volée (`stolen_card`) |
| `4000 0000 0000 0069` | Carte expirée (`expired_card`) |
| `4000 0000 0000 0127` | CVC incorrect (`incorrect_cvc`) |
| `4000 0000 0000 0119` | Erreur de traitement (`processing_error`) |

En cas de refus, Stripe affiche l'erreur **sur sa propre page** et l'utilisateur peut réessayer avec une autre carte. La commande reste « en attente » côté MuscleShop.

## Ce qui se passe dans MuscleShop

| Situation | Page de retour | Statut de la commande | Stock | Panier |
| --- | --- | --- | --- | --- |
| Paiement accepté | `/commande/confirmation` | `paid` | décrémenté | vidé |
| Bouton « Retour » sur Stripe | `/commande/annulee` | `cancelled` | inchangé | conservé |
| Carte refusée | reste sur Stripe | `pending` | inchangé | conservé |
| Onglet fermé après paiement | aucune | `pending` jusqu'à la prochaine visite de la confirmation (un webhook réglerait ce cas) | | |

Les paiements de test sont visibles dans le dashboard Stripe, avec l'interrupteur **Mode test** activé, rubrique **Paiements**.

Liste complète des cartes de test : https://docs.stripe.com/testing
