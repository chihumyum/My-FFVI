/** A source SysCall parks its current task while the shared shop is open.
 * The two surrounding messages remain instructions of the original script. */
export type FieldScriptShopOp = {
  kind: "field-script-shop";
  selector: string;
  groupId: number;
};
