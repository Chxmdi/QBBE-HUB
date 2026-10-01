"use client";

import { useObjectsT } from "@/features/objects/i18n/client";
import type { RecordPerson, RecordProperty } from "@/features/objects/services/record-page.queries";
import { PropertyField } from "./property-field";

/**
 * One `properties` section of a record page (U14): the layout's properties in
 * its order, each as a field. The server has already removed anything the
 * viewer may not see, so a missing key is simply skipped.
 */
export function PropertiesSection({
  objectId,
  objectType,
  keys,
  properties,
  people,
  members,
  canEdit,
}: {
  objectId: string;
  objectType: string;
  keys: string[];
  properties: Record<string, RecordProperty>;
  people: Record<string, string>;
  members: RecordPerson[];
  canEdit: boolean;
}) {
  const t = useObjectsT();
  const shown = keys.map((key) => properties[key]).filter((property): property is RecordProperty => Boolean(property));

  if (shown.length === 0) return <p className="meta">{t("record.properties.none")}</p>;

  return (
    <div className="flex flex-col gap-2">
      {!canEdit ? <p className="meta">{t("record.properties.readOnly")}</p> : null}
      <dl className="card divide-y divide-line">
        {shown.map((property) => (
          <PropertyField
            key={property.key}
            objectId={objectId}
            objectType={objectType}
            property={property}
            people={people}
            members={members}
          />
        ))}
      </dl>
    </div>
  );
}
