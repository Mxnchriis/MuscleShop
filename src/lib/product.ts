export const PLACEHOLDER_IMAGE = '/images/products/placeholder.svg';

// Image du produit, ou placeholder tant qu'aucune photo n'est renseignée en base
export const productImage = (product: { image: string | null }) => product.image ?? PLACEHOLDER_IMAGE;
