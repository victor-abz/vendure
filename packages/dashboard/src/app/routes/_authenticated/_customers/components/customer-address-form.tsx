import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { FieldDescription, FieldLabel } from '@/vdb/components/ui/field.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { addressFragment } from '../customers.graphql.js';

// Query document to fetch available countries
const getAvailableCountriesDocument = graphql(`
    query GetAvailableCountries {
        countries(options: { filter: { enabled: { eq: true } } }) {
            items {
                id
                code
                name
            }
        }
    }
`);

// Define the form schema using zod
const addressFormSchema = z.object({
    id: z.string(),
    fullName: z.string().optional(),
    company: z.string().optional(),
    streetLine1: z.string().min(1, { message: 'Street address is required' }),
    streetLine2: z.string().optional(),
    city: z.string().min(1, { message: 'City is required' }),
    province: z.string().optional(),
    postalCode: z.string().optional(),
    countryCode: z.string().min(1, { message: 'Country is required' }),
    phoneNumber: z.string().optional(),
    defaultShippingAddress: z.boolean().default(false),
    defaultBillingAddress: z.boolean().default(false),
    customFields: z.any().optional(),
});

export type AddressFormValues = z.infer<typeof addressFormSchema>;

interface CustomerAddressFormProps {
    address?: ResultOf<typeof addressFragment>;
    onSubmit?: (values: AddressFormValues) => void;
    onCancel?: () => void;
}

export function CustomerAddressForm({ address, onSubmit, onCancel }: Readonly<CustomerAddressFormProps>) {
    const { t } = useLingui();

    // Fetch available countries
    const { data: countriesData, isLoading: isLoadingCountries } = useQuery({
        queryKey: ['availableCountries'],
        queryFn: () => api.query(getAvailableCountriesDocument),
        staleTime: 1000 * 60 * 60 * 24, // 24 hours
    });

    // Set up form with react-hook-form and zod
    const form = useForm<AddressFormValues>({
        resolver: zodResolver(addressFormSchema),
        values: {
            id: address?.id || '',
            fullName: address?.fullName || '',
            company: address?.company || '',
            streetLine1: address?.streetLine1 || '',
            streetLine2: address?.streetLine2 || '',
            city: address?.city || '',
            province: address?.province || '',
            postalCode: address?.postalCode || '',
            countryCode: address?.country.code || '',
            phoneNumber: address?.phoneNumber || '',
            defaultShippingAddress: address?.defaultShippingAddress || false,
            defaultBillingAddress: address?.defaultBillingAddress || false,
            customFields: (address as any)?.customFields || {},
        },
    });

    return (
        <Form {...form}>
            <form
                onSubmit={e => {
                    e.stopPropagation();
                    onSubmit && form.handleSubmit(onSubmit)(e);
                }}
                className="space-y-4"
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Full Name */}
                    <FormFieldWrapper
                        control={form.control}
                        name="fullName"
                        label={<Trans>Full Name</Trans>}
                        render={({ field }) => <Input placeholder="John Doe" {...field} value={field.value || ''} />}
                    />

                    {/* Company */}
                    <FormFieldWrapper
                        control={form.control}
                        name="company"
                        label={<Trans>Company</Trans>}
                        render={({ field }) => (
                            <Input placeholder="Company (optional)" {...field} value={field.value || ''} />
                        )}
                    />

                    {/* Street Line 1 */}
                    <FormFieldWrapper
                        control={form.control}
                        name="streetLine1"
                        label={<Trans>Street Address</Trans>}
                        render={({ field }) => (
                            <Input placeholder="123 Main St" {...field} value={field.value || ''} />
                        )}
                    />

                    {/* Street Line 2 */}
                    <FormFieldWrapper
                        control={form.control}
                        name="streetLine2"
                        label={<Trans>Apartment, suite, etc.</Trans>}
                        render={({ field }) => (
                            <Input placeholder="Apt 4B (optional)" {...field} value={field.value || ''} />
                        )}
                    />

                    {/* City */}
                    <FormFieldWrapper
                        control={form.control}
                        name="city"
                        label={<Trans>City</Trans>}
                        render={({ field }) => <Input placeholder="City" {...field} value={field.value || ''} />}
                    />

                    {/* Province/State */}
                    <FormFieldWrapper
                        control={form.control}
                        name="province"
                        label={<Trans>State/Province</Trans>}
                        render={({ field }) => (
                            <Input
                                placeholder="State/Province (optional)"
                                {...field}
                                value={field.value || ''}
                            />
                        )}
                    />

                    {/* Postal Code */}
                    <FormFieldWrapper
                        control={form.control}
                        name="postalCode"
                        label={<Trans>Postal Code</Trans>}
                        render={({ field }) => (
                            <Input placeholder="Postal Code" {...field} value={field.value || ''} />
                        )}
                    />

                    {/* Country */}
                    <FormFieldWrapper
                        control={form.control}
                        name="countryCode"
                        label={<Trans>Country</Trans>}
                        renderFormControl={false}
                        render={({ field }) => (
                            <Select
                                items={countriesData ? Object.fromEntries(countriesData.countries.items.map(c => [c.code, c.name])) : {}}
                                onValueChange={field.onChange}
                                defaultValue={field.value || undefined}
                                value={field.value || undefined}
                                disabled={isLoadingCountries}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t`Select a country`} />
                                </SelectTrigger>
                                <SelectContent>
                                    {countriesData?.countries.items.map(country => (
                                        <SelectItem key={country.code} value={country.code}>
                                            {country.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />

                    {/* Phone Number */}
                    <FormFieldWrapper
                        control={form.control}
                        name="phoneNumber"
                        label={<Trans>Phone Number</Trans>}
                        render={({ field }) => (
                            <Input placeholder="Phone (optional)" {...field} value={field.value || ''} />
                        )}
                    />
                </div>

                {/* Custom Fields */}
                <CustomFieldsForm entityType="Address" control={form.control} />
                {/* Default Address Checkboxes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <Controller
                        control={form.control}
                        name="defaultShippingAddress"
                        render={({ field }) => (
                            <div className="flex flex-row items-start space-x-3">
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                <div className="space-y-1 leading-none">
                                    <FieldLabel>
                                        <Trans>Default Shipping Address</Trans>
                                    </FieldLabel>
                                    <FieldDescription>
                                        <Trans>Use as the default shipping address</Trans>
                                    </FieldDescription>
                                </div>
                            </div>
                        )}
                    />

                    <Controller
                        control={form.control}
                        name="defaultBillingAddress"
                        render={({ field }) => (
                            <div className="flex flex-row items-start space-x-3">
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                <div className="space-y-1 leading-none">
                                    <FieldLabel>
                                        <Trans>Default Billing Address</Trans>
                                    </FieldLabel>
                                    <FieldDescription>
                                        <Trans>Use as the default billing address</Trans>
                                    </FieldDescription>
                                </div>
                            </div>
                        )}
                    />
                </div>

                {/* Form Actions */}
                <div className="flex justify-end gap-2 pt-4">
                    {onCancel && (
                        <Button type="button" variant="outline" onClick={onCancel}>
                            <Trans>Cancel</Trans>
                        </Button>
                    )}
                    <Button type="submit">
                        <Trans>Save Address</Trans>
                    </Button>
                </div>
            </form>
        </Form>
    );
}
