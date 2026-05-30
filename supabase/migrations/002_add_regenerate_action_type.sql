-- Allow 'regenerate_blog_draft' as an article action type (used by the
-- regenerate-existing-article feature). Recreate the inline CHECK constraint
-- from 001_initial_schema.sql with the new value added.

ALTER TABLE article_actions DROP CONSTRAINT article_actions_action_type_check;

ALTER TABLE article_actions ADD CONSTRAINT article_actions_action_type_check CHECK (action_type IN (
  'favorite', 'exclude', 'hold', 'mark_reviewed',
  'generate_blog_draft', 'generate_x_post', 'publish_to_wordpress',
  'regenerate_blog_draft'
));
