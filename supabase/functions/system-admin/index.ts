import { createClient } from "@supabase/supabase-js"

type StorageObject = { bucket_id: string; name: string }
type DeletionJob = {
  id: string
  kind: "account" | "game"
  subject_id: string
  objects: StorageObject[]
  stage: "storage" | "auth" | "complete"
}
type OrganizerRow = { id: string; auth_user_id: string | null; is_system_profile: boolean }
type CreatorRow = { id: string; organizer_id: string; display_name: string }
type TemplateRow = {
  id: string; organizer_id: string; creator_profile_id: string; title: string
  venue: string; visibility: "public" | "personal"; created_at: string
}
type GameRow = {
  id: string; organizer_id: string; title: string; venue: string
  status: string; created_at: string
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are unavailable")

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The administrative action could not be completed"
}

async function requireSystemAdmin(accessToken: string) {
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken)
  if (userError || !userData.user || userData.user.is_anonymous) {
    throw Object.assign(new Error("Sign in with a permanent organizer account"), { status: 401 })
  }

  const { data: membership, error: membershipError } = await admin
    .from("system_admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle()
  if (membershipError) throw membershipError
  if (!membership) throw Object.assign(new Error("System administrator access required"), { status: 403 })
  return userData.user
}

async function listAllAuthUsers() {
  const users = []
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < 1000) return users
  }
  throw new Error("User list exceeded the supported page limit")
}

async function listAllTemplates() {
  const rows: TemplateRow[] = []
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await admin.from("hunt_templates")
      .select("id,organizer_id,creator_profile_id,title,venue,visibility,created_at")
      .order("created_at", { ascending: false }).order("id").range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as TemplateRow[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
  throw new Error("Hunt template list exceeded the supported page limit")
}

async function listAllGames() {
  const rows: GameRow[] = []
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await admin.from("hunts")
      .select("id,organizer_id,title,venue,status,created_at")
      .order("created_at", { ascending: false }).order("id").range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as GameRow[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
  throw new Error("Game list exceeded the supported page limit")
}

async function listAllOrganizers() {
  const rows: OrganizerRow[] = []
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await admin.from("organizers")
      .select("id,auth_user_id,is_system_profile").order("id").range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as OrganizerRow[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
  throw new Error("Organizer list exceeded the supported page limit")
}

async function listAllCreatorProfiles() {
  const rows: CreatorRow[] = []
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await admin.from("hunt_creator_profiles")
      .select("id,organizer_id,display_name").order("id").range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as CreatorRow[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
  throw new Error("Creator profile list exceeded the supported page limit")
}

async function listAllAdminIds() {
  const rows: string[] = []
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await admin.from("system_admins")
      .select("user_id").order("user_id").range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []).map(row => row.user_id as string)
    rows.push(...page)
    if (page.length < 1000) return rows
  }
  throw new Error("System administrator list exceeded the supported page limit")
}

async function listAllOrganizerGames(organizerId: string) {
  const rows: { id: string; title: string; status: string }[] = []
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await admin.from("hunts")
      .select("id,title,status").eq("organizer_id", organizerId).order("id").range(offset, offset + 999)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < 1000) return rows
  }
  throw new Error("Organizer game list exceeded the supported page limit")
}

async function loadSnapshot() {
  const [users, organizerRows, creatorRows, templates, games, adminIds, deletionJobs] = await Promise.all([
    listAllAuthUsers(),
    listAllOrganizers(),
    listAllCreatorProfiles(),
    listAllTemplates(),
    listAllGames(),
    listAllAdminIds(),
    admin.from("system_admin_deletion_jobs").select("id,kind,stage,created_at")
      .neq("stage", "complete").order("created_at").limit(100),
  ])

  if (deletionJobs.error) throw deletionJobs.error
  const allUsers = users.filter(user => !user.is_anonymous)
  const emailById = new Map(allUsers.map(user => [user.id, user.email ?? "No email"] as const))
  const adminIdSet = new Set(adminIds)
  const organizerById = new Map(organizerRows.map(row => [row.id, row] as const))
  const creatorById = new Map(creatorRows.map(row => [row.id, row] as const))

  const ownerLabel = (organizerId: string) => {
    const organizer = organizerById.get(organizerId)
    if (!organizer) return "Unknown organizer"
    if (organizer.is_system_profile) return "SnapQuest Community"
    return organizer.auth_user_id ? emailById.get(organizer.auth_user_id) ?? "Deleted account" : "SnapQuest Community"
  }

  const templateCounts = new Map<string, number>()
  const gameCounts = new Map<string, number>()
  for (const template of templates) templateCounts.set(template.organizer_id, (templateCounts.get(template.organizer_id) ?? 0) + 1)
  for (const game of games) gameCounts.set(game.organizer_id, (gameCounts.get(game.organizer_id) ?? 0) + 1)

  return {
    accounts: allUsers.map(user => {
      const organizer = organizerRows.find(row => row.auth_user_id === user.id)
      return {
        id: user.id,
        email: user.email ?? "No email",
        confirmed: Boolean(user.email_confirmed_at),
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
        isAdmin: adminIdSet.has(user.id),
        templates: organizer ? templateCounts.get(organizer.id) ?? 0 : 0,
        games: organizer ? gameCounts.get(organizer.id) ?? 0 : 0,
      }
    }).sort((left, right) => left.email.localeCompare(right.email)),
    templates: templates.map(template => ({
      id: template.id,
      title: template.title,
      venue: template.venue,
      visibility: template.visibility,
      creator: creatorById.get(template.creator_profile_id)?.display_name ?? ownerLabel(template.organizer_id),
      owner: ownerLabel(template.organizer_id),
      createdAt: template.created_at,
    })),
    games: games.map(game => ({
      id: game.id,
      title: game.title,
      venue: game.venue,
      status: game.status,
      owner: ownerLabel(game.organizer_id),
      createdAt: game.created_at,
    })),
    deletionJobs: deletionJobs.data,
    totalAccounts: allUsers.length,
    totalTemplates: templates.length,
    totalGames: games.length,
  }
}

async function getAccountDeletionPreview(targetUserId: string, actorUserId: string) {
  if (targetUserId === actorUserId) throw Object.assign(new Error("Administrators cannot delete their own account"), { status: 409 })
  const { data: targetResult, error: targetError } = await admin.auth.admin.getUserById(targetUserId)
  if (targetError || !targetResult.user) throw Object.assign(new Error("Account not found"), { status: 404 })
  const target = targetResult.user
  if (target.is_anonymous) throw Object.assign(new Error("Guest identities are not listed as organizer accounts"), { status: 409 })

  const { data: membership, error: membershipError } = await admin.from("system_admins").select("user_id").eq("user_id", targetUserId).maybeSingle()
  if (membershipError) throw membershipError
  if (membership) throw Object.assign(new Error("Remove system administrator access before deleting this account"), { status: 409 })

  const { data: organizer, error: organizerError } = await admin.from("organizers").select("id").eq("auth_user_id", targetUserId).maybeSingle()
  if (organizerError) throw organizerError

  let publicTemplates = 0
  let privateTemplates = 0
  let games: { id: string; title: string; status: string }[] = []
  if (organizer) {
    const [publicResult, privateResult, organizerGames] = await Promise.all([
      admin.from("hunt_templates").select("id", { count: "exact", head: true }).eq("organizer_id", organizer.id).eq("visibility", "public"),
      admin.from("hunt_templates").select("id", { count: "exact", head: true }).eq("organizer_id", organizer.id).eq("visibility", "personal"),
      listAllOrganizerGames(organizer.id),
    ])
    if (publicResult.error) throw publicResult.error
    if (privateResult.error) throw privateResult.error
    publicTemplates = publicResult.count ?? 0
    privateTemplates = privateResult.count ?? 0
    games = organizerGames
  }

  const { data: participantCount, error: participantError, count: participants } = await admin
    .from("participants").select("id", { count: "exact", head: true }).eq("auth_user_id", targetUserId)
  void participantCount
  if (participantError) throw participantError
  const { count: messages, error: messageError } = await admin
    .from("hunt_messages").select("id", { count: "exact", head: true }).eq("sender_user_id", targetUserId)
  if (messageError) throw messageError
  const { data: storageObjects, error: storageError } = await admin.rpc("system_admin_storage_objects", { p_user_id: targetUserId, p_hunt_id: null })
  if (storageError) throw storageError
  const ownedObjects = Array.isArray(storageObjects) ? storageObjects.length : 0

  const activeGames = games.filter(game => ["scheduled", "active", "review"].includes(game.status))
  const draftGames = games.filter(game => game.status === "draft")
  const preservedGames = games.filter(game => ["completed", "archived"].includes(game.status))
  return {
    userId: targetUserId,
    email: target.email ?? "No email",
    publicTemplatesToTransfer: publicTemplates,
    privateTemplatesToDelete: privateTemplates,
    draftGamesToDelete: draftGames.length,
    completedGamesToPreserve: preservedGames.length,
    activeGamesToResolve: activeGames,
    participantsToAnonymize: participants ?? 0,
    messagesToRemove: messages ?? 0,
    ownedStorageObjectsToRemove: ownedObjects,
    canDelete: activeGames.length === 0,
  }
}

async function removeStorageObjects(objects: StorageObject[]) {
  const byBucket = new Map<string, string[]>()
  for (const object of objects) {
    if (!object?.bucket_id || !object?.name) continue
    const names = byBucket.get(object.bucket_id) ?? []
    names.push(object.name)
    byBucket.set(object.bucket_id, names)
  }
  for (const [bucketId, names] of byBucket) {
    for (let offset = 0; offset < names.length; offset += 100) {
      const { error } = await admin.storage.from(bucketId).remove(names.slice(offset, offset + 100))
      if (error) throw new Error(`Storage cleanup failed for bucket ${bucketId}`)
    }
  }
}

async function startDeletion(actorId: string, kind: DeletionJob["kind"], subjectId: string) {
  const { data, error } = await admin.rpc("system_admin_start_deletion", {
    p_actor_user_id: actorId, p_kind: kind, p_subject_id: subjectId,
  })
  if (error) throw new Error(error.message)
  return data as string
}

async function advanceDeletion(job: DeletionJob, stage: DeletionJob["stage"]) {
  const { error } = await admin.from("system_admin_deletion_jobs")
    .update({ stage, objects: [] }).eq("id", job.id).eq("stage", job.stage)
  if (error) throw new Error("Could not save deletion progress")
  job.stage = stage
}

async function resumeDeletion(id: string) {
  const { data, error } = await admin.from("system_admin_deletion_jobs")
    .select("id,kind,subject_id,objects,stage").eq("id", id).maybeSingle()
  if (error) throw new Error("Could not load deletion progress")
  if (!data) return respond({ error: "Deletion request not found" }, 404)
  const job = data as DeletionJob

  try {
    if (job.stage === "storage") {
      await removeStorageObjects(job.objects)
      await advanceDeletion(job, job.kind === "account" ? "auth" : "complete")
    }
    if (job.stage === "auth") {
      const { error: deleteError } = await admin.auth.admin.deleteUser(job.subject_id)
      if (deleteError && deleteError.code !== "user_not_found" && deleteError.status !== 404) throw deleteError
      await advanceDeletion(job, "complete")
    }
    return respond({ deleted: true, jobId: job.id })
  } catch {
    return respond({ error: "Deletion is still pending. Refresh the admin workspace and resume the deletion.", jobId: job.id }, 502)
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return respond({ error: "Use POST for administrative actions" }, 405)

  const authorization = request.headers.get("Authorization")
  const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!tokenMatch) return respond({ error: "Sign in with a permanent organizer account" }, 401)

  try {
    const actor = await requireSystemAdmin(tokenMatch[1])
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = body.action

    if (action === "check") return respond({ isAdmin: true })
    if (action === "snapshot") return respond(await loadSnapshot())

    if (action === "resume-deletion") {
      if (!isUuid(body.jobId)) return respond({ error: "Choose a pending deletion" }, 400)
      return await resumeDeletion(body.jobId)
    }

    if (action === "preview-delete-account") {
      if (!isUuid(body.userId)) return respond({ error: "Choose an account" }, 400)
      return respond(await getAccountDeletionPreview(body.userId, actor.id))
    }

    if (action === "delete-account") {
      if (!isUuid(body.userId)) return respond({ error: "Choose an account" }, 400)
      const preview = await getAccountDeletionPreview(body.userId, actor.id)
      if (!preview.canDelete) return respond({ error: "Resolve the listed scheduled or active hunts before deleting this account", preview }, 409)
      if (typeof body.confirmation !== "string" || body.confirmation !== preview.email) {
        return respond({ error: "Type the account email exactly to confirm deletion" }, 400)
      }

      return await resumeDeletion(await startDeletion(actor.id, "account", body.userId))
    }

    if (action === "delete-template") {
      if (!isUuid(body.templateId)) return respond({ error: "Choose a hunt template" }, 400)
      const { data: template, error: lookupError } = await admin.from("hunt_templates").select("id,title").eq("id", body.templateId).maybeSingle()
      if (lookupError) throw lookupError
      if (!template) return respond({ error: "Hunt template not found" }, 404)
      if (body.confirmation !== template.title) return respond({ error: "Type the hunt title exactly to confirm deletion" }, 400)
      const { error } = await admin.rpc("system_admin_delete_template", { p_actor_user_id: actor.id, p_template_id: body.templateId })
      if (error) throw error
      return respond({ deleted: true, title: template.title })
    }

    if (action === "delete-game") {
      if (!isUuid(body.gameId)) return respond({ error: "Choose a game" }, 400)
      const { data: game, error: lookupError } = await admin.from("hunts").select("id,title").eq("id", body.gameId).maybeSingle()
      if (lookupError) throw lookupError
      if (!game) return respond({ error: "Game not found" }, 404)
      if (body.confirmation !== game.title) return respond({ error: "Type the game title exactly to confirm deletion" }, 400)
      return await resumeDeletion(await startDeletion(actor.id, "game", body.gameId))
    }

    return respond({ error: "Unknown administrative action" }, 400)
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500
    return respond({ error: errorMessage(error) }, Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500)
  }
})
