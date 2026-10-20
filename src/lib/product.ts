export const PLACEHOLDER_IMAGE = '/images/products/placeholder.svg';

// Image du produit, ou placeholder tant qu'aucune photo n'est renseignée en base
export const productImage = (product: { image: string | null }) => product.image ?? PLACEHOLDER_IMAGE;

// Réduction en % arrondie (ex. 3990 → 3290 = 18), ou null si le produit n'est pas en promo
export function discountPercent(product: { price: number; originalPrice: number | null }) {
  if (!product.originalPrice || product.originalPrice <= product.price) return null;
  return Math.round((1 - product.price / product.originalPrice) * 100);
}
