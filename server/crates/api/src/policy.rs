//! Pure permission policy: (actor role, target role, action) -> allowed.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Owner,
    Admin,
    Member,
}

impl Role {
    pub fn parse(s: &str) -> Option<Role> {
        match s {
            "owner" => Some(Role::Owner),
            "admin" => Some(Role::Admin),
            "member" => Some(Role::Member),
            _ => None,
        }
    }
    fn rank(self) -> u8 {
        match self {
            Role::Owner => 2,
            Role::Admin => 1,
            Role::Member => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Rename,
    Delete,
    Invite,
    Kick,
    ChangeRole,
    ForceStop,
    BlockStream,
    Transfer,
}

/// Whether `actor` may perform `action`. For actions on another member, `target`
/// is that member's role; the actor must outrank the target (and an admin may
/// never act on an admin or owner).
pub fn allowed(actor: Role, action: Action, target: Option<Role>) -> bool {
    use Action::*;
    let outranks = |t: Option<Role>| t.map_or(true, |t| actor.rank() > t.rank());
    match action {
        Rename | Invite => matches!(actor, Role::Owner | Role::Admin),
        Delete | ChangeRole | Transfer => actor == Role::Owner,
        ForceStop => matches!(actor, Role::Owner | Role::Admin),
        Kick | BlockStream => matches!(actor, Role::Owner | Role::Admin) && outranks(target),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix() {
        use Action::*;
        use Role::*;
        let cases = [
            (Owner,  Rename,        None,           true),
            (Admin,  Rename,        None,           true),
            (Member, Rename,        None,           false),
            (Owner,  Delete,        None,           true),
            (Admin,  Delete,        None,           false),
            (Owner,  Invite,        None,           true),
            (Admin,  Invite,        None,           true),
            (Member, Invite,        None,           false),
            (Admin,  Kick,          Some(Member),   true),
            (Admin,  Kick,          Some(Admin),    false),
            (Owner,  Kick,          Some(Admin),    true),
            (Admin,  Kick,          Some(Owner),    false),
            (Owner,  ChangeRole,    Some(Member),   true),
            (Admin,  ChangeRole,    Some(Member),   false),
            (Owner,  ForceStop,     None,           true),
            (Admin,  ForceStop,     None,           true),
            (Member, ForceStop,     None,           false),
            (Admin,  BlockStream,   Some(Member),   true),
            (Admin,  BlockStream,   Some(Admin),    false),
            (Owner,  BlockStream,   Some(Admin),    true),
            (Member, BlockStream,   Some(Member),   false),
            (Owner,  Transfer,      None,           true),
            (Admin,  Transfer,      None,           false),
        ];
        for (actor, action, target, expected) in cases {
            assert_eq!(allowed(actor, action, target), expected, "{actor:?} {action:?} {target:?}");
        }
    }
}
