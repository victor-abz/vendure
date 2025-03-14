import { assetFragment } from '@/graphql/fragments.js';
import { graphql } from '@/graphql/graphql.js';

export const productListDocument = graphql(`
    query ProductList($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                createdAt
                updatedAt
                featuredAsset {
                    id
                    preview
                }
                name
                slug
                enabled
            }
            totalItems
        }
    }
`);

export const productDetailFragment = graphql(
    `
        fragment ProductDetail on Product {
            id
            createdAt
            updatedAt
            enabled
            name
            slug
            description
            featuredAsset {
                ...Asset
            }
            assets {
                ...Asset
            }
            translations {
                id
                languageCode
                name
                slug
                description
            }

            facetValues {
                id
                name
                code
                facet {
                    id
                    name
                    code
                }
            }
        }
    `,
    [assetFragment],
);

export const productVariantListDocument = graphql(`
    query ProductVariantList($options: ProductVariantListOptions, $productId: ID) {
        productVariants(options: $options, productId: $productId) {
            items {
                id
                name
                sku
                currencyCode
                price
                priceWithTax
            }
        }
    }
`);

export const productDetailDocument = graphql(
    `
        query ProductDetail($id: ID!) {
            product(id: $id) {
                ...ProductDetail
            }
        }
    `,
    [productDetailFragment],
);

export const updateProductDocument = graphql(
    `
        mutation UpdateProduct($input: UpdateProductInput!) {
            updateProduct(input: $input) {
                ...ProductDetail
            }
        }
    `,
    [productDetailFragment],
);
