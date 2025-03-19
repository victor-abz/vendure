import { PageActionBar } from '@/framework/layout-engine/page-layout.js';
import { ListPage } from '@/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { productVariantListDocument } from './product-variants.graphql.js';
import { Button } from '@/components/ui/button.js';
import { Money } from '@/components/data-type-components/money.js';
import { useLocalFormat } from '@/hooks/use-local-format.js';

export const Route = createFileRoute('/_authenticated/_product-variants/product-variants')({
    component: ProductListPage,
    loader: () => ({ breadcrumb: () => <Trans>Product Variants</Trans> }),
});

export function ProductListPage() {
    const { formatCurrencyName } = useLocalFormat();
    return (
        <ListPage
            title={<Trans>Product Variants</Trans>}
            customizeColumns={{
                name: {
                    header: 'Product Name',
                    cell: ({ row }) => {
                        return (
                            <Button asChild variant="ghost">
                                <Link to={`./${row.original.id}`}>{row.original.name} </Link>
                            </Button>
                        );
                    },
                },
                currencyCode: {
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        return formatCurrencyName(value as string, 'full');
                    },
                },
                price: {
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        const currencyCode = row.original.currencyCode;
                        if (typeof value === 'number') {
                            return <Money value={value} currency={currencyCode} />;
                        }
                        return value;
                    },
                },
                priceWithTax: {
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        const currencyCode = row.original.currencyCode;
                        if (typeof value === 'number') {
                            return <Money value={value} currency={currencyCode} />;
                        }
                        return value;
                    },
                },
                stockLevels: {
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        if (Array.isArray(value)) {
                            const totalOnHand = value.reduce((acc, curr) => acc + curr.stockOnHand, 0);
                            const totalAllocated = value.reduce((acc, curr) => acc + curr.stockAllocated, 0);
                            return <span>{totalOnHand} / {totalAllocated}</span>;
                        }
                        return value;
                    },
                },
            }}
            onSearchTermChange={searchTerm => {
                return {
                    name: { contains: searchTerm },
                };
            }}
            listQuery={productVariantListDocument}
            route={Route}
        >
            <PageActionBar>
                <div></div>
            </PageActionBar>
        </ListPage>
    );
}
