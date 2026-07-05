import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import DataLoader from 'dataloader';
import { FindOptionsUtils } from 'typeorm/find-options/FindOptionsUtils';

import { Translatable } from '../../common/types/locale-types';
import { RelationCustomFieldConfig } from '../../config/custom-field/custom-field-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { VendureEntity } from '../../entity/base/base.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ProductPriceApplicator } from '../../service/helpers/product-price-applicator/product-price-applicator';
import { TranslatorService } from '../../service/helpers/translator/translator.service';

import { RequestContext } from './request-context';

export interface ResolveRelationConfig {
    ctx: RequestContext;
    entityId: ID;
    entityName: string;
    fieldDef: RelationCustomFieldConfig;
}

@Injectable()
export class CustomFieldRelationResolverService {
    constructor(
        private connection: TransactionalConnection,
        private productPriceApplicator: ProductPriceApplicator,
        private translator: TranslatorService,
    ) {}

    /**
     * @description
     * Dynamically resolves related entities in custom fields using request-scoped
     * DataLoader batching to eliminate N+1 query overhead in list contexts.
     */
    async resolveRelation(config: ResolveRelationConfig): Promise<VendureEntity | VendureEntity[]> {
        const { ctx, entityId, entityName, fieldDef } = config;

        // Establish a unique cache key for this context loop combining entity and custom field constraints
        const loaderKey = `CustomFieldRelationLoader:${entityName}:${fieldDef.name}`;
        
        // Attach a dynamic memory store to the RequestContext instance if not already initialized
        const ctxWithCache = ctx as any;
        if (!ctxWithCache._customFieldLoaders) {
            ctxWithCache._customFieldLoaders = {};
        }

        // Initialize the loader if it doesn't exist for the current tick
        if (!ctxWithCache._customFieldLoaders[loaderKey]) {
            ctxWithCache._customFieldLoaders[loaderKey] = new DataLoader<ID, VendureEntity[]>(async (ids) => {
                // Fetch the inner relationship mapping across all batched parent IDs at once
                const subQb = this.connection
                    .getRepository(ctx, entityName)
                    .createQueryBuilder('entity')
                    .leftJoin(`entity.customFields.${fieldDef.name}`, 'relationEntity')
                    .select(['entity.id AS entity_id', 'relationEntity.id AS relation_id'])
                    .where('entity.id IN (:...ids)', { ids });

                const rawMappings = await subQb.getRawMany();

                // Group relation IDs by their parent entity keys
                const mappingMap = new Map<ID, ID[]>();
                for (const row of rawMappings) {
                    const eId = row.entity_id;
                    const rId = row.relation_id;
                    if (rId) {
                        if (!mappingMap.has(eId)) mappingMap.set(eId, []);
                        mappingMap.get(eId)!.push(rId);
                    }
                }

                // Extract all unique relation IDs to fetch the structural target records efficiently
                const allRelationIds = Array.from(new Set(rawMappings.map(row => row.relation_id).filter(Boolean)));

                let relations: VendureEntity[] = [];
                if (allRelationIds.length > 0) {
                    const qb = this.connection
                        .getRepository(ctx, fieldDef.entity)
                        .createQueryBuilder('relation')
                        .where('relation.id IN (:...allRelationIds)', { allRelationIds });

                    FindOptionsUtils.joinEagerRelations(qb, qb.alias, qb.expressionMap.mainAlias!.metadata);
                    relations = await qb.getMany();
                }

                const relationMap = new Map<ID, VendureEntity>();
                for (const rel of relations) {
                    relationMap.set(rel.id, rel);
                }

                // Map grouped entities back to their exact original request positions to preserve array invariants
                return ids.map(id => {
                    const targetIds = mappingMap.get(id) || [];
                    return targetIds.map(tId => relationMap.get(tId)!).filter(Boolean);
                });
            });
        }

        const loader = ctxWithCache._customFieldLoaders[loaderKey];
        const batchResult = await loader.load(entityId);

        // Adjust formatting dynamically depending on whether the schema structure expects an array collection or single value
        const finalResult = fieldDef.list ? batchResult : (batchResult[0] || null);

        return await this.translateEntity(ctx, finalResult, fieldDef);
    }

    async translateEntity(
        ctx: RequestContext,
        result: VendureEntity | VendureEntity[] | null,
        fieldDef: RelationCustomFieldConfig,
    ) {
        if (result == null) return null;

        if (fieldDef.entity === ProductVariant) {
            if (Array.isArray(result)) {
                await Promise.all(result.map(r => this.applyVariantPrices(ctx, r as any)));
            } else {
                await this.applyVariantPrices(ctx, result as any);
            }
        }

        const translated: any = Array.isArray(result)
            ? result.map(r => (this.isTranslatable(r) ? this.translator.translate(r, ctx) : r))
            : this.isTranslatable(result)
              ? this.translator.translate(result, ctx)
              : result;

        return translated;
    }

    private isTranslatable(input: unknown): input is Translatable {
        return typeof input === 'object' && input != null && input.hasOwnProperty('translations');
    }

    private async applyVariantPrices(ctx: RequestContext, variant: ProductVariant): Promise<ProductVariant> {
        const taxCategory = await this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder()
            .relation('taxCategory')
            .of(variant)
            .loadOne();
        variant.taxCategory = taxCategory;
        return this.productPriceApplicator.applyChannelPriceAndTax(variant, ctx);
    }
}