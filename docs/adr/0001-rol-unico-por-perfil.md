# Un solo rol por perfil

Cada perfil tiene exactamente un rol (`alumno`, `profesor`, `admin`, y `tutor` desde B4.6), impuesto con `UNIQUE(user_id)` en `user_roles`. El login elegía el rol con `ORDER BY id LIMIT 1` (arbitrario) y el JWT lleva un solo rol, así que el multi-rol dejaba sin definir qué rol rige y si "perfil completo" aplica. Se aplaza hasta que haya un caso real; quien necesite dos papeles usa dos perfiles. La capacidad de ser tutor no depende del rol: la da la relación tutor→menor (ver `CONTEXT.md`).

Desarrollo ([ADR 0028](0028-alta-de-profesores-por-el-admin.md)): el profesor que también entrena tiene dos perfiles, uno de alumno con su email personal y otro de profesor con correo corporativo, sin vínculo en la BD.
