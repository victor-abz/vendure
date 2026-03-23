import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { Alert, AlertDescription } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Field, FieldError } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Form } from '@/vdb/components/ui/form.js';
import { toast } from 'sonner';
import { z } from 'zod';
import { createProductVariantsDocument } from '../products.graphql.js';

interface OptionGroup {
    id: string;
    code: string;
    name: string;
    options: Array<{
        id: string;
        code: string;
        name: string;
    }>;
}

interface GeneratedVariant {
    id: string;
    name: string;
    optionIds: string[];
    optionNames: string[];
}

const variantSchema = z.object({
    enabled: z.boolean().default(true),
    sku: z.string().min(1, { message: 'SKU is required' }),
    price: z.string().refine(val => !isNaN(Number(val)) && Number(val) >= 0, {
        message: 'Price must be a positive number',
    }),
    stock: z.string().refine(val => !isNaN(Number(val)) && parseInt(val, 10) >= 0, {
        message: 'Stock must be a non-negative integer',
    }),
});

const formSchema = z.object({
    variants: z.record(variantSchema),
});

type VariantFormValues = z.infer<typeof formSchema>;

function generateVariantCombinations(optionGroups: OptionGroup[]): GeneratedVariant[] {
    const validGroups = optionGroups.filter(g => g.options.length > 0);
    if (validGroups.length === 0) return [];

    const combine = (
        groups: OptionGroup[],
        index: number,
        current: { id: string; name: string }[],
    ): GeneratedVariant[] => {
        if (index === groups.length) {
            return [
                {
                    id: current.map(c => c.id).join('-'),
                    name: current.map(c => c.name).join(' '),
                    optionIds: current.map(c => c.id),
                    optionNames: current.map(c => c.name),
                },
            ];
        }
        const results: GeneratedVariant[] = [];
        for (const option of groups[index].options) {
            results.push(...combine(groups, index + 1, [...current, { id: option.id, name: option.name }]));
        }
        return results;
    };

    return combine(validGroups, 0, []);
}

export function GenerateVariantsPanel({
    productId,
    productName,
    optionGroups,
    onSuccess,
}: Readonly<{
    productId: string;
    productName: string;
    optionGroups: OptionGroup[];
    onSuccess?: () => void;
}>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();

    const variants = useMemo(() => generateVariantCombinations(optionGroups), [optionGroups]);

    const form = useForm<VariantFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            variants: Object.fromEntries(
                variants.map(v => [
                    v.id,
                    { enabled: true, sku: '', price: '', stock: '' },
                ]),
            ),
        },
        mode: 'onChange',
    });

    const createVariantsMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
    });

    const handleCreateVariants = form.handleSubmit(async formValues => {
        if (!activeChannel?.defaultLanguageCode) return;

        const variantsToCreate = variants
            .filter(v => formValues.variants[v.id]?.enabled)
            .map(v => {
                const data = formValues.variants[v.id];
                const name = v.optionNames.length
                    ? `${productName} ${v.optionNames.join(' ')}`
                    : productName;

                return {
                    productId,
                    sku: data.sku,
                    price: Number(data.price),
                    stockOnHand: Number(data.stock),
                    optionIds: v.optionIds,
                    translations: [
                        {
                            languageCode: activeChannel.defaultLanguageCode,
                            name,
                        },
                    ],
                };
            });

        if (variantsToCreate.length === 0) return;

        try {
            await createVariantsMutation.mutateAsync({ input: variantsToCreate });
            toast.success(t`Successfully created variants`);
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to create variants`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    });

    const watchedVariants = useWatch({ control: form.control, name: 'variants' });
    const enabledCount = variants.filter(v => watchedVariants?.[v.id]?.enabled).length;

    if (variants.length === 0) {
        return (
            <Alert>
                <AlertDescription>
                    <Trans>
                        The assigned option groups have no options yet. Add options to your option groups
                        before generating variants.
                    </Trans>
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <Form {...form}>
            <div className="space-y-4">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {variants.length > 1 && (
                                <TableHead className="w-12">
                                    <Trans>Create</Trans>
                                </TableHead>
                            )}
                            {variants.length > 1 && (
                                <TableHead>
                                    <Trans>Variant</Trans>
                                </TableHead>
                            )}
                            <TableHead>
                                <Trans>SKU</Trans>
                            </TableHead>
                            <TableHead>
                                <Trans>Price</Trans>
                            </TableHead>
                            <TableHead>
                                <Trans>Stock on Hand</Trans>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {variants.map(variant => (
                            <TableRow key={variant.id}>
                                {variants.length > 1 && (
                                    <TableCell>
                                        <Controller
                                            control={form.control}
                                            name={`variants.${variant.id}.enabled`}
                                            render={({ field }) => (
                                                <Field className="flex items-center space-x-2">
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                </Field>
                                            )}
                                        />
                                    </TableCell>
                                )}

                                {variants.length > 1 && (
                                    <TableCell className="font-medium">
                                        {variant.optionNames.join(' / ')}
                                    </TableCell>
                                )}

                                <TableCell>
                                    <Controller
                                        control={form.control}
                                        name={`variants.${variant.id}.sku`}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <Input {...field} placeholder="SKU" data-testid="variant-sku-input" />
                                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                            </Field>
                                        )}
                                    />
                                </TableCell>

                                <TableCell>
                                    <Controller
                                        control={form.control}
                                        name={`variants.${variant.id}.price`}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <MoneyInput
                                                    {...field}
                                                    value={Number(field.value) || 0}
                                                    onChange={value =>
                                                        field.onChange(value.toString())
                                                    }
                                                    currency={
                                                        activeChannel?.defaultCurrencyCode
                                                    }
                                                />
                                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                            </Field>
                                        )}
                                    />
                                </TableCell>

                                <TableCell>
                                    <Controller
                                        control={form.control}
                                        name={`variants.${variant.id}.stock`}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <Input
                                                    {...field}
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    data-testid="variant-stock-input"
                                                />
                                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                            </Field>
                                        )}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <div className="flex justify-end">
                    <Button
                        type="button"
                        onClick={handleCreateVariants}
                        disabled={createVariantsMutation.isPending || enabledCount === 0}
                    >
                        <Save className="mr-2 h-4 w-4" />
                        {createVariantsMutation.isPending ? (
                            <Trans>Creating...</Trans>
                        ) : (
                            <Trans>Create {enabledCount} variants</Trans>
                        )}
                    </Button>
                </div>
            </div>
        </Form>
    );
}
