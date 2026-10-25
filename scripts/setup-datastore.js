/**
 * Prints the Settings, Rules and Processed table definitions for the Catalyst Data Store.
 * Usage: node scripts/setup-datastore.js
 * Create these tables in the Catalyst console (Cloud Scale > Data Store > Create Table) with exactly
 * these columns before the first deploy. docs/setup.md lists them too.
 */
const TABLES = [
  {
    table_name: 'Settings',
    note: 'One row, written by the admin page. Holds the Instagram access token.',
    columns: [
      { column_name: 'ig_user_id', data_type: 'varchar', max_length: 32 },
      { column_name: 'username', data_type: 'varchar', max_length: 64 },
      { column_name: 'access_token', data_type: 'text' },
      { column_name: 'token_expires_at', data_type: 'bigint' },
    ],
  },
  {
    table_name: 'Rules',
    columns: [
      { column_name: 'media_id', data_type: 'varchar', max_length: 32, is_mandatory: true },
      { column_name: 'permalink', data_type: 'varchar', max_length: 255 },
      { column_name: 'caption_preview', data_type: 'varchar', max_length: 255 },
      { column_name: 'keyword', data_type: 'varchar', max_length: 100, is_mandatory: true },
      { column_name: 'dm_text', data_type: 'text', is_mandatory: true },
      { column_name: 'gate_text', data_type: 'text' },
      { column_name: 'enabled', data_type: 'varchar', max_length: 5 },
    ],
  },
  {
    table_name: 'Processed',
    note: 'Turn on "Unique" for comment_id: it stops double replies when Meta re-sends a webhook.',
    columns: [
      { column_name: 'comment_id', data_type: 'varchar', max_length: 32, is_mandatory: true, is_unique: true },
      { column_name: 'media_id', data_type: 'varchar', max_length: 32 },
      { column_name: 'from_id', data_type: 'varchar', max_length: 32 },
      { column_name: 'from_username', data_type: 'varchar', max_length: 64 },
      { column_name: 'comment_text', data_type: 'text' },
      { column_name: 'rule_id', data_type: 'varchar', max_length: 32 },
      { column_name: 'dm_status', data_type: 'varchar', max_length: 10 },
      { column_name: 'reply_status', data_type: 'varchar', max_length: 10 },
      { column_name: 'reply_text', data_type: 'varchar', max_length: 255 },
      { column_name: 'unlock_status', data_type: 'varchar', max_length: 10 },
      { column_name: 'unlock_expires_at', data_type: 'bigint' },
      { column_name: 'unlocked_at', data_type: 'bigint' },
      { column_name: 'error', data_type: 'varchar', max_length: 255 },
    ],
  },
];

console.log(JSON.stringify(TABLES, null, 2));
console.log('\nCreate these three tables in the Catalyst console (Cloud Scale > Data Store > Create Table)');
console.log('using exactly the columns above. Remember: comment_id in Processed must be Unique.');
