CREATE TABLE public.jarvis_state (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_state TO authenticated;
GRANT ALL ON public.jarvis_state TO service_role;
ALTER TABLE public.jarvis_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own assistant data" ON public.jarvis_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);