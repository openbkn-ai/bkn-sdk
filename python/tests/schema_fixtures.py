# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""A schema built to exercise the emitter, not to look pretty.

It carries every standard BKN type plus a non-standard one, a composite primary
key, an id that collides with a query method, and two relation types — so the
golden files below record the answer to each of those questions in one place.

Once the parser lands, this becomes the parsed form of a captured live schema
and the goldens are regenerated from it.
"""

from __future__ import annotations

from bkn_osdk.schema import KnSchema, ObjectTypeDef, PropertyDef, RelationTypeDef

DEMO_SCHEMA = KnSchema(
    kn_id="ecommerce_ops_bkn_public",
    branch="main",
    display_name="电商经营决策知识网络",
    object_types=(
        ObjectTypeDef(
            bkn_id="order",
            properties=(
                PropertyDef(bkn_id="order_id", type="integer"),
                PropertyDef(bkn_id="order_no", type="string"),
                PropertyDef(bkn_id="total_amount", type="decimal"),
                PropertyDef(bkn_id="created_at", type="datetime"),
                PropertyDef(bkn_id="paid_on", type="date"),
                PropertyDef(bkn_id="settled_at", type="time"),
                PropertyDef(bkn_id="is_paid", type="boolean"),
                PropertyDef(bkn_id="discount_rate", type="float"),
                PropertyDef(bkn_id="notes", type="text"),
                PropertyDef(bkn_id="payload", type="json"),
                PropertyDef(bkn_id="invoice_pdf", type="binary"),
                PropertyDef(bkn_id="embedding", type="vector"),  # non-standard: passes through
                PropertyDef(bkn_id="count", type="integer"),  # collides with a query method
            ),
            primary_key=("order_id",),
            display_key="order_no",
        ),
        ObjectTypeDef(
            bkn_id="order_line",
            properties=(
                PropertyDef(bkn_id="order_id", type="integer"),
                PropertyDef(bkn_id="line_no", type="integer"),
                PropertyDef(bkn_id="sku", type="string"),
            ),
            primary_key=("order_id", "line_no"),
        ),
        ObjectTypeDef(
            bkn_id="people",
            properties=(
                PropertyDef(bkn_id="person_id", type="string"),
                PropertyDef(bkn_id="name", type="string"),
                PropertyDef(bkn_id="age", type="integer"),
            ),
            primary_key=("person_id",),
            display_key="name",
        ),
    ),
    relation_types=(
        RelationTypeDef(
            bkn_id="order_to_line",
            source="order",
            target="order_line",
            mapping_rules=(("order_id", "order_id"),),
        ),
        RelationTypeDef(bkn_id="order_to_buyer", source="order", target="people"),
    ),
)
