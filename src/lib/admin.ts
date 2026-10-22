import type { OrderStatus } from '../types';

// Libellé + classe de statut (pastille de couleur + texte : jamais la couleur seule)
export const orderStatus: Record<OrderStatus, { label: string; className: string }> = {
  pending: { label: 'En attente', className: 'status status-warning' },
  paid: { label: 'Payée', className: 'status status-good' },
  shipped: { label: 'Expédiée', className: 'status status-neutral' },
  cancelled: { label: 'Annulée', className: 'status status-critical' },
};

export function stockStatus(stock: number, lowThreshold = 10) {
  if (stock === 0) return { label: 'Rupture', className: 'status status-critical' };
  if (stock <= lowThreshold) return { label: 'Stock bas', className: 'status status-warning' };
  return { label: 'OK', className: 'status status-good' };
}

const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

const integer = new Intl.NumberFormat('fr-FR');
export const formatInt = (value: number) => integer.format(value);

// Formats utilisés par les graphiques (le nom circule en data-attribute, la fonction reste côté navigateur)
export const chartFormats = {
  eur: (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100),
  count: (value: number) => integer.format(value),
  ms: (value: number) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: value < 10 ? 2 : 1 })} ms`,
};
export type ChartFormat = keyof typeof chartFormats;
