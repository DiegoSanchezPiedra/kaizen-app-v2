# Crear hijos es un permiso por usuario que da el admin

Decisión del 2026-11-12 (migración 062). Evita el alta masiva de hijos falsos.

Hasta ahora cualquier adulto podía dar de alta hijos (`create_child`). Ahora además necesita el **permiso de crear hijos**:

- **Dónde vive**: `auth_credentials.can_create_children`, junto a `can_book`. `app_user` solo lo lee; nunca tiene `UPDATE`
  sobre la columna, así que nadie se lo puede dar a sí mismo.
- **Quién lo cambia**: solo un admin, con `set_can_create_children` (SECURITY DEFINER), desde la ficha del usuario en
  `/admin/users/:id`. Cada cambio deja `profile.can_create_children` en `audit_log`. Sin MFA: no da poder sobre otros.
- **Dónde se aplica**: dentro de `create_child`, después de comprobar que quien llama es adulto. La API lo traduce a
  403 `child_creation_not_allowed`; la app oculta «Añadir hijo o hija» y muestra «contacta con administración».
- **Por defecto**: no. La migración se lo dio a quien ya era tutor de algún hijo.
- **Revocar** solo impide altas nuevas: los hijos ya creados y sus vínculos no cambian. Sin límite de hijos.
- Descartado: atarlo al rol `tutor` (el rol es para quien no entrena; un alumno también puede ser tutor) o al plan.
