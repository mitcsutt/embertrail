import type { Command } from '../command.ts'
import { UsageError } from '../errors.ts'
import { dash, listing, printable } from '../output.ts'

const role = ['member', 'editor'] as const

export const adminCommands: Command[] = [
  {
    path: ['admin', 'users', 'list'],
    summary: 'List every User',
    async run(ctx) {
      const { items } = await (await ctx.client()).listUsers()
      ctx.print(
        items,
        listing(
          'Users',
          ['ID', 'NAME', 'EMAIL', 'ADMIN'],
          items.map((u) => [u.id, u.name, dash(u.email), u.admin ? 'yes' : 'no']),
        ),
      )
    },
  },
  {
    path: ['admin', 'users', 'create'],
    summary: 'Create a User, and a management Token for them',
    description:
      'Creates a User and, unless --no-token, a management Token for them, shown once and expiring no later than yours. ' +
      'A User with an email can sign in through Edge Identity instead, so give them --no-token.',
    positionals: [{ name: 'name', description: "The User's name" }],
    options: {
      email: { type: 'string', value: 'email', description: 'Matched against an Edge Identity' },
      admin: { type: 'boolean', description: 'Make them an Admin' },
      'no-token': { type: 'boolean', description: 'Do not issue a Token' },
    },
    async run(ctx, args) {
      const email = args.string('email')
      const { user, token } = await (
        await ctx.client()
      ).createUser({
        body: {
          name: args.positional(0),
          ...(email === undefined ? {} : { email }),
          ...(args.flag('admin') ? { admin: true } : {}),
          ...(args.flag('no-token') ? { token: false } : {}),
        },
      })
      ctx.print(
        { user, token },
        [
          `Created User "${printable(user.name)}" (${user.id}).`,
          ...(token === null ? [] : [`Token (shown once): ${token}`]),
        ].join('\n'),
      )
    },
  },
  {
    path: ['admin', 'users', 'delete'],
    summary: 'Delete a User and everything they own',
    description:
      'Hard delete: the User, their Sources, Tokens, Accounts, Grants and Team memberships, and every row they own in every Module.',
    positionals: [{ name: 'user-id', description: 'The User to delete' }],
    async run(ctx, args) {
      const id = args.positional(0)
      await (await ctx.client()).deleteUser({ path: { user_id: id } })
      ctx.print({ deleted: id }, `Deleted User ${id}.`)
    },
  },
  {
    path: ['admin', 'teams', 'list'],
    summary: 'List every Team',
    async run(ctx) {
      const { items } = await (await ctx.client()).listTeams()
      ctx.print(
        items,
        listing(
          'Teams',
          ['ID', 'NAME'],
          items.map((t) => [t.id, t.name]),
        ),
      )
    },
  },
  {
    path: ['admin', 'teams', 'create'],
    summary: 'Create a Team',
    positionals: [{ name: 'name', description: "The Team's name" }],
    options: {
      id: {
        type: 'string',
        value: 'id',
        description: 'Its id (letters, digits, _ and -); generated when omitted',
      },
    },
    async run(ctx, args) {
      const id = args.string('id')
      const team = await (
        await ctx.client()
      ).createTeam({
        body: { name: args.positional(0), ...(id === undefined ? {} : { id }) },
      })
      ctx.print(team, `Created Team "${printable(team.name)}" (${team.id}).`)
    },
  },
  {
    path: ['admin', 'teams', 'delete'],
    summary: 'Delete a Team and everything it owns',
    positionals: [{ name: 'team-id', description: 'The Team to delete' }],
    async run(ctx, args) {
      const id = args.positional(0)
      await (await ctx.client()).deleteTeam({ path: { team_id: id } })
      ctx.print({ deleted: id }, `Deleted Team ${id}.`)
    },
  },
  {
    path: ['admin', 'teams', 'set-member'],
    summary: 'Add a User to a Team, or change their role',
    description: "Members read the Team's data; editors also act for the Team.",
    positionals: [
      { name: 'team-id', description: 'The Team' },
      { name: 'user-id', description: 'The User' },
    ],
    options: {
      role: { type: 'string', value: role.join('|'), description: 'Their role (default member)' },
    },
    async run(ctx, args) {
      const chosen = args.string('role') ?? 'member'
      const value = role.find((r) => r === chosen)
      if (value === undefined) throw new UsageError(`--role is ${role.join(' or ')}`)
      const member = await (
        await ctx.client()
      ).setTeamMember({
        path: { team_id: args.positional(0), user_id: args.positional(1) },
        body: { role: value },
      })
      ctx.print(member, `${member.user_id} is a ${member.role} of ${member.team_id}.`)
    },
  },
  {
    path: ['admin', 'teams', 'remove-member'],
    summary: 'Remove a User from a Team',
    positionals: [
      { name: 'team-id', description: 'The Team' },
      { name: 'user-id', description: 'The User' },
    ],
    async run(ctx, args) {
      const path = { team_id: args.positional(0), user_id: args.positional(1) }
      await (await ctx.client()).removeTeamMember({ path })
      ctx.print(path, `Removed ${path.user_id} from ${path.team_id}.`)
    },
  },
  {
    path: ['admin', 'sources', 'list'],
    summary: "List every User's Sources",
    async run(ctx) {
      const { items } = await (await ctx.client()).listAllSources()
      ctx.print(
        items,
        listing(
          'Sources',
          ['ID', 'NAME', 'OWNER'],
          items.map((s) => [s.id, s.name, s.owner_id]),
        ),
      )
    },
  },
  {
    path: ['admin', 'sources', 'delete'],
    summary: 'Delete any Source and every Signal it sent',
    positionals: [{ name: 'source-id', description: 'The Source to delete' }],
    async run(ctx, args) {
      const id = args.positional(0)
      await (await ctx.client()).deleteAnySource({ path: { source_id: id } })
      ctx.print({ deleted: id }, `Deleted Source ${id}.`)
    },
  },
]
