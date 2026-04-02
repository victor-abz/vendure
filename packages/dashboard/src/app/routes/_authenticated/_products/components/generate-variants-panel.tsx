import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Field, FieldError } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Form } from '@/vdb/components/ui/form.js';
import { toast } from 'sonner';
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

const variantSchema = z
    .object({
        enabled: z.boolean(),
        sku: z.string(),
        price: z.string(),
        stock: z.string(),
    })
    .superRefine((data, ctx) => {
        if (!data.enabled) return;
        if (!data.sku || data.sku.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'SKU is required',
                path: ['sku'],
            });
        }
        if (data.price !== '' && (Number.isNaN(Number(data.price)) || Number(data.price) < 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Price must be a non-negative number',
                path: ['price'],
            });
        }
        const stockNum = Number(data.stock);
        if (data.stock !== '' && (Number.isNaN(stockNum) || stockNum < 0 || !Number.isInteger(stockNum))) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Stock must be a non-negative integer',
                path: ['stock'],
            });
        }
    });

const formSchema = z.object({
    variants: z.record(variantSchema),
});

type VariantFormValues = z.infer<typeof formSchema>;

function generateVariantCombinations(optionGroups: OptionGroup[]): GeneratedVariant[] {
    const validGroups = optionGroups.filter(g => g.options.length > 0);
    if (validGroups.length === 0) {
        return [{ id: 'default', name: '', optionIds: [], optionNames: [] }];
    }

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
    onBack,
}: Readonly<{
    productId: string;
    productName: string;
    optionGroups: OptionGroup[];
    onSuccess?: () => void;
    onBack?: {
        handler: () => void;
        confirmation?: { title: string; description: string };
    };
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
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
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

                <div className="flex justify-between items-center">
                    <div>
                        {onBack && (
                            onBack.confirmation ? (
                                <ConfirmationDialog
                                    title={onBack.confirmation.title}
                                    description={onBack.confirmation.description}
                                    onConfirm={onBack.handler}
                                >
                                    <button
                                        type="button"
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        ← <Trans>Back</Trans>
                                    </button>
                                </ConfirmationDialog>
                            ) : (
                                <button
                                    type="button"
                                    onClick={onBack.handler}
                                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    ← <Trans>Back</Trans>
                                </button>
                            )
                        )}
                    </div>
                    <Button
                        type="button"
                        onClick={handleCreateVariants}
                        disabled={createVariantsMutation.isPending || enabledCount === 0}
                    >
                        <Save className="mr-2 h-4 w-4" />
                        {createVariantsMutation.isPending && <Trans>Creating...</Trans>}
                        {!createVariantsMutation.isPending && enabledCount === 1 && <Trans>Create variant</Trans>}
                        {!createVariantsMutation.isPending && enabledCount !== 1 && <Trans>Create {enabledCount} variants</Trans>}
                    </Button>
                </div>
            </div>
        </Form>
    );
}
