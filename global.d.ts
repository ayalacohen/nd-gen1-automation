/// <reference types="@wdio/globals/types" />
/// <reference types="mocha" />
declare global {
  type DbRow = {
    id?: number;
    type_id: number;
    field_a?: string;
    field_b?: string;
    field_c?: string;
    field_d?: string;
    log_where?: string;
  };
}

export {};