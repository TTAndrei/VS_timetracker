# Instrucciones para Claude Code

## Sistema de ejecucion
Este proyecto usa executor.py + Aider + Qwen local para ejecutar tareas.
Cuando el usuario pide crear un plan, SIEMPRE generar plan.json con el esquema exacto de abajo.

## Esquema obligatorio plan.json

```json
{
  "task_summary": "descripcion corta de la tarea",
  "complexity": "low|medium|high",
  "steps": [
    {
      "id": 1,
      "description": "que hace este step",
      "files_involved": ["archivo.ts", "otro.py"],
      "aider_instruction": "instruccion detallada en ingles para Qwen/Aider. Incluir codigo exacto cuando sea posible.",
      "use_local_model": true
    }
  ],
  "validation_criteria": [
    "criterio verificable 1",
    "criterio verificable 2"
  ]
}
```

## Reglas para plan.json
- `task_summary`: una frase, maximo 100 chars
- `complexity`: low (1-3 steps), medium (4-6 steps), high (7+ steps)
- `aider_instruction`: en INGLES, detallada, con codigo exacto. Qwen no infiere — necesita instrucciones precisas.
- `files_involved`: solo archivos que ese step modifica/crea
- `use_local_model`: siempre true (usa Qwen local)
- Maximo 8 steps por plan. Si tarea es mayor, dividir en multiples planes.
- Cada step debe ser atomico (una responsabilidad)
- Incluir step de tests si la tarea lo requiere

## Para ejecutar el plan
```bat
E:\IA_local\run.bat plan.json .
```

## Estilo de codigo
- Python: type hints siempre, docstrings en español
- TypeScript: tipos estrictos, sin any
- Sin comentarios obvios
- Tests para funciones criticas
