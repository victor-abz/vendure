import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';
import { RichTextEditor } from '../shared/rich-text-editor/rich-text-editor.js';

/**
 * @description
 * A component for displaying a rich text editor. Internally uses ProseMirror (rich text editor) under the hood.
 *
 * @docsCategory form-components
 * @docsPage RichTextInput
 */
export function RichTextInput({ value, onChange, fieldDef, disabled }: Readonly<DashboardFormComponentProps>) {
    const readOnly = isFieldDisabled(disabled, fieldDef);

    return <RichTextEditor value={value} onChange={onChange} disabled={readOnly} />;
}
