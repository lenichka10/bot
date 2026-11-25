\set ON_ERROR_STOP 1
set role anon;
-- anon can read rounds and groups
select count(*) = 1 as one_active_round from rounds where active \gset
\if :one_active_round \else \echo FAIL one round; \quit \endif
-- claim
select (claim_group(1, '11111111-1111-1111-1111-111111111111')->>'ok')::bool as c1 \gset
\if :c1 \else \echo FAIL claim; \quit \endif
select (claim_group(1, '22222222-2222-2222-2222-222222222222')->>'reason') = 'taken' as c2 \gset
\if :c2 \else \echo FAIL second claim not taken; \quit \endif
select id as rid from rounds where active \gset
-- save with right token works, wrong token not
select save_state(:'rid', 1, '11111111-1111-1111-1111-111111111111', '{"step":2}') = 'ok' as s1 \gset
\if :s1 \else \echo FAIL save; \quit \endif
select save_state(:'rid', 1, '22222222-2222-2222-2222-222222222222', '{"step":4}') = 'gone' as s2 \gset
\if :s2 \else \echo FAIL foreign save; \quit \endif
select (state->>'step') = '2' as s3 from groups where group_no = 1 \gset
\if :s3 \else \echo FAIL state; \quit \endif
-- direct writes and secret tables are blocked
\set ON_ERROR_STOP 0
update groups set state = '{}';
insert into groups(round_id, group_no) values (:'rid', 5);
select * from group_claims;
select * from app_settings;
select leitung_pin_ok('1234');
delete from rounds;
\set ON_ERROR_STOP 1
select (state->>'step') = '2' as s4 from groups where group_no = 1 \gset
\if :s4 \else \echo FAIL direct update went through; \quit \endif
select count(*) = 1 as s5 from rounds \gset
\if :s5 \else \echo FAIL delete went through; \quit \endif
-- PIN
select not leitung_check('0000') as p1 \gset
\if :p1 \else \echo FAIL wrong pin accepted; \quit \endif
select leitung_check('1234') as p2 \gset
\if :p2 \else \echo FAIL pin; \quit \endif
\set ON_ERROR_STOP 0
select leitung_release('0000', 1);
\set ON_ERROR_STOP 1
select count(*) = 1 as p3 from groups \gset
\if :p3 \else \echo FAIL release without pin; \quit \endif
-- profession
select leitung_set_profession('1234', 'polymech');
select profession = 'polymech' as q1 from rounds where active \gset
\if :q1 \else \echo FAIL profession; \quit \endif
-- release
select leitung_release('1234', 1);
select count(*) = 0 as r1 from groups \gset
\if :r1 \else \echo FAIL release; \quit \endif
select check_claim(:'rid', 1, '11111111-1111-1111-1111-111111111111') = false as r2 \gset
\if :r2 \else \echo FAIL claim survived release; \quit \endif
select (claim_group(1, '22222222-2222-2222-2222-222222222222')->>'ok')::bool as r3 \gset
\if :r3 \else \echo FAIL reclaim after release; \quit \endif
select check_claim(:'rid', 1, '22222222-2222-2222-2222-222222222222') as r4 \gset
\if :r4 \else \echo FAIL check_claim; \quit \endif
-- new round
select leitung_new_round('1234') as nid \gset
select count(*) = 0 as n1 from groups \gset
\if :n1 \else \echo FAIL answers not deleted; \quit \endif
select count(*) = 1 and bool_and(active) and bool_and(profession = 'polymech') as n2 from rounds \gset
\if :n2 \else \echo FAIL new round; \quit \endif
select save_state(:'rid', 1, '22222222-2222-2222-2222-222222222222', '{}') = 'gone' as n3 \gset
\if :n3 \else \echo FAIL old round still saves; \quit \endif
reset role;
select count(*) = 2 as pub from pg_publication_tables where pubname = 'supabase_realtime' \gset
\if :pub \else \echo FAIL realtime publication; \quit \endif
\echo SQL CHECKS OK
