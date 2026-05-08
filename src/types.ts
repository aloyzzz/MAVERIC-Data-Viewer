export type ColumnType = 'text' | 'int' | 'float' | 'bool' | 'time' | 'tag' | 'frame';

export interface ColumnDef {
  id: string;
  label: string;
  type: ColumnType;
  width: number;
  mono: boolean;
  align: 'left' | 'right';
  pk: number | null;
  fk: string | null;
}

export interface TableMeta {
  id: string;
  label: string;
  desc: string;
  primary: string;
  rows: number;
}

export interface SchemaGroup {
  name: string;
  tables: TableMeta[];
}

export interface AppSchema {
  schemas: SchemaGroup[];
  columns: Record<string, ColumnDef[]>;
}

export type Row = Record<string, unknown> & { __idx: number };

export interface SortState {
  col: string;
  dir: 'asc' | 'desc';
}

export interface FilterChip {
  col: string;
  op: string;
  val: string;
}
