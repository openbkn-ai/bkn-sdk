# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The base classes a generated package declares against.

One name does two jobs, which is the whole ergonomic trick::

    People.name          # a PropertyRef — builds filters
    person.name          # a str — the value

`Property` implements the descriptor protocol, so `__get__` returns the
reference on class access (`obj is None`) and the deserialized value on
instance access. Both are typed, so `People.age > 30` type-checks and
`People.name > 30` does not.

Generated code carries declarations only. Everything here is runtime, which is
why a new operator or a fixed round-trip reaches existing generated packages
through `pip install -U bkn-osdk` with no regeneration.
"""

from __future__ import annotations

import sys
from collections.abc import Iterable, Iterator, Mapping, Sequence
from datetime import date, datetime, time
from decimal import Decimal
from typing import TYPE_CHECKING, Any, ClassVar, Generic, TypeVar, overload

from .config import Context
from .errors import InputError, SchemaDriftError
from .query import Comparison, Filter, Sort

if TYPE_CHECKING:
    from .query import ObjectSet, Page
    from .subgraph import RelationPath

__all__ = ["ObjectType", "Property", "PropertyRef", "Relation"]

T = TypeVar("T")
S = TypeVar("S", bound="ObjectType")

#: Reserved keys that accompany every instance on the wire. They are renamed on
#: the way in so they cannot collide with a real property called `id`.
INSTANCE_ID_KEY = "_instance_id"
IDENTITY_KEY = "_instance_identity"
DISPLAY_KEY = "_display"
_RESERVED_KEYS = frozenset({INSTANCE_ID_KEY, IDENTITY_KEY, DISPLAY_KEY})


class PropertyRef(Generic[T]):
    """A property seen from the class, i.e. the left-hand side of a filter."""

    def __init__(self, bkn_id: str, python_type: type[Any] | None = None) -> None:
        self.bkn_id = bkn_id
        self.python_type = python_type

    def __repr__(self) -> str:
        return f"PropertyRef({self.bkn_id!r})"

    # `__eq__` returning a filter rather than a bool is the cost of the DSL: it
    # is what makes `People.age == 30` an expression instead of a comparison.
    # Identity hashing is kept so a reference can still live in a set or a dict.
    def __eq__(self, other: T) -> Comparison:  # type: ignore[override]
        return Comparison("==", self.bkn_id, other)

    def __ne__(self, other: T) -> Comparison:  # type: ignore[override]
        return Comparison("!=", self.bkn_id, other)

    __hash__ = object.__hash__

    def __gt__(self, other: T) -> Comparison:
        return Comparison(">", self.bkn_id, other)

    def __ge__(self, other: T) -> Comparison:
        return Comparison(">=", self.bkn_id, other)

    def __lt__(self, other: T) -> Comparison:
        return Comparison("<", self.bkn_id, other)

    def __le__(self, other: T) -> Comparison:
        return Comparison("<=", self.bkn_id, other)

    def is_in(self, values: Iterable[T]) -> Comparison:
        return Comparison("in", self.bkn_id, list(values))

    def not_in(self, values: Iterable[T]) -> Comparison:
        return Comparison("not_in", self.bkn_id, list(values))

    def like(self, pattern: str) -> Comparison:
        """Text match whose semantics belong to the **backing resource**.

        The value is sent verbatim, because the two deploys probed disagree:

        - a Postgres-backed object type treated it as a plain substring, where
          `like("2026")` matched every row containing it and `like("2026%")`
          matched none — `%` was a literal;
        - a Vega-catalog-backed one treated it as a SQL pattern, where
          `like("%FIFA%")` matched all 30 rows and `like("FIFA")` matched none.

        So neither form is universally right, and a wrong guess returns zero rows
        rather than an error. Try both against the object type you are querying.
        """
        return Comparison("like", self.bkn_id, pattern)

    def not_like(self, pattern: str) -> Comparison:
        """The negation of `like`, with the same resource-dependent semantics."""
        return Comparison("not_like", self.bkn_id, pattern)

    def match(self, query: str) -> Comparison:
        """Full-text match, where the backing resource implements it.

        In the tool's operator enum, but not universally supported: a Postgres-
        backed object type answered HTTP 500 with `operation match is not
        supported`. Prefer `like` unless the resource is known to index text.
        """
        return Comparison("match", self.bkn_id, query)

    def exists(self) -> Comparison:
        return Comparison("exist", self.bkn_id)

    def not_exists(self) -> Comparison:
        return Comparison("not_exist", self.bkn_id)

    def near(self, vector: Sequence[float], k: int = 10) -> Comparison:
        """Vector search on a property carrying an embedding.

        Whether the backend requires a built vector index is not settled — no
        object type on the platform this was designed against has one — so an
        unindexed property may answer with an error rather than a result.
        """
        return Comparison("knn", self.bkn_id, list(vector), limit_key="k", limit_value=k)

    def asc(self) -> Sort:
        return Sort(self.bkn_id, "asc")

    def desc(self) -> Sort:
        return Sort(self.bkn_id, "desc")


class Property(Generic[T]):
    """A declared property. Generated code instantiates these and nothing else."""

    def __init__(self, bkn_id: str) -> None:
        self.bkn_id = bkn_id
        self.attribute = bkn_id

    def __set_name__(self, owner: type[ObjectType], name: str) -> None:
        # The attribute may differ from the id — `count` becomes `count_` so it
        # does not shadow the inherited query method.
        self.attribute = name

    @overload
    def __get__(self, obj: None, owner: type[ObjectType]) -> PropertyRef[T]: ...

    @overload
    def __get__(self, obj: ObjectType, owner: type[ObjectType]) -> T: ...

    def __get__(self, obj: ObjectType | None, owner: type[ObjectType]) -> PropertyRef[T] | T:
        if obj is None:
            return PropertyRef(self.bkn_id, self.python_type)
        value: T = obj.__value_of__(self)
        return value

    def __repr__(self) -> str:
        return f"Property({self.bkn_id!r})"

    @property
    def python_type(self) -> type[Any] | None:
        """The `T` of `Property[T]("…")`, recovered from the generic alias.

        Used to decode the wire value, which cannot be done from the value alone:
        a decimal and a string both arrive as JSON strings, and only the declared
        type says which is which. Absent when a property was written without a
        parameter, in which case the value passes through untouched.
        """
        alias = getattr(self, "__orig_class__", None)
        args = getattr(alias, "__args__", ())
        return args[0] if args and isinstance(args[0], type) else None


class Relation(Generic[T]):
    """A declared relation, traversable from an instance.

    `order.buyer.take(10)` is one hop, and one hop is a filter: the schema
    declares the join columns, so the traversal is an ordinary instance query on
    the target object type::

        order.buyer  ==  User.where(User.user_id == order.user_id)

    Doing it this way rather than through `query_instance_subgraph` keeps
    traversal on the REST read path — no lifecycle session, no second grammar,
    and the same paging and ordering as any other set. Multi-hop paths are what
    the subgraph tool is actually for, and are not modelled here.

    Class access returns the declaration; instance access returns the set.
    """

    def __init__(
        self,
        bkn_id: str,
        *,
        target: str,
        join: tuple[tuple[str, str], ...] = (),
    ) -> None:
        self.bkn_id = bkn_id
        self.attribute = bkn_id
        #: The target object type's BKN id; resolved to its class on first use.
        self.target = target
        #: `(source property, target property)` pairs the relation joins on.
        self.join = join

    def __set_name__(self, owner: type[ObjectType], name: str) -> None:
        self.attribute = name
        self.owner = owner

    @overload
    def __get__(self, obj: None, owner: type[ObjectType]) -> Relation[T]: ...

    @overload
    def __get__(self, obj: ObjectType, owner: type[ObjectType]) -> ObjectSet[Any]: ...

    def __get__(
        self, obj: ObjectType | None, owner: type[ObjectType]
    ) -> Relation[T] | ObjectSet[Any]:
        if obj is None:
            return self
        return self.of(obj)

    def then(self, relation: Relation[Any]) -> RelationPath:
        """Chain another hop, making this a multi-hop path.

        Two hops cannot be a filter on the far end — the intermediate rows would
        have to come back to the client to be joined — so a path is walked
        server-side by `query_instance_subgraph`, which needs a managed
        interaction. See `subgraph.RelationPath`.
        """
        from .subgraph import RelationPath

        return RelationPath((self, relation))

    def of(self, instance: ObjectType) -> ObjectSet[Any]:
        """The target set for one instance, filtered on the declared join."""
        from .query import Comparison, ObjectSet

        if not self.join:
            raise InputError(
                f"Relation '{self.bkn_id}' declares no join columns, so it cannot be "
                "traversed. Regenerate the package; if the schema really has none, query "
                "the target object type directly."
            )

        target = self._target_class()
        combined: Filter | None = None
        for source_property, target_property in self.join:
            value = self._source_value(instance, source_property)
            node = Comparison("==", target_property, value)
            combined = node if combined is None else combined & node
        hop: ObjectSet[Any] = ObjectSet(target, context=instance.__context__)
        return hop.where(combined) if combined is not None else hop

    def _source_value(self, instance: ObjectType, source_property: str) -> Any:
        data = instance.__data__
        if source_property not in data:
            raise SchemaDriftError(
                f"'{type(instance).__name__}.{source_property}' is needed to traverse "
                f"'{self.attribute}' but was not returned for this instance — select it, "
                "or fetch the instance without a property selection."
            )
        return data[source_property]

    def _target_class(self) -> type[ObjectType]:
        """Find the target class beside the owner, where the generator put it."""
        module = sys.modules.get(getattr(self, "owner", type(None)).__module__)
        for value in vars(module).values() if module else ():
            if (
                isinstance(value, type)
                and issubclass(value, ObjectType)
                and value.__bkn_id__ == self.target
            ):
                return value
        raise SchemaDriftError(
            f"Relation '{self.bkn_id}' points at object type '{self.target}', which this "
            "package does not define. Regenerate it with `bkn-osdk generate`."
        )

    def __repr__(self) -> str:
        return f"Relation({self.bkn_id!r} -> {self.target!r})"


class ObjectType:
    """Base of every generated object-type class.

    An instance wraps one row exactly as the platform sent it, converting values
    on first access rather than up front: a query that selects three of forty
    properties should not pay for the other thirty-seven.
    """

    __kn_id__: ClassVar[str] = ""
    __bkn_id__: ClassVar[str] = ""
    __primary_key__: ClassVar[tuple[str, ...]] = ()
    __display_key__: ClassVar[str | None] = None

    def __init__(self, data: Mapping[str, Any]) -> None:
        self.__data__: dict[str, Any] = {
            key: value for key, value in data.items() if key not in _RESERVED_KEYS
        }
        self.__cache__: dict[str, Any] = {}
        instance_id = data.get(INSTANCE_ID_KEY)
        identity = data.get(IDENTITY_KEY)
        self.__instance_id__: str | None = instance_id if isinstance(instance_id, str) else None
        self.__identity__: dict[str, Any] = dict(identity) if isinstance(identity, Mapping) else {}
        #: The display-key value, `null` when that property was not selected.
        self.__display__: Any = data.get(DISPLAY_KEY)
        #: Set on a traced read: the receipt that accounts for this instance.
        self.__receipt__: dict[str, Any] | None = None
        #: Where this row was read from. A hop off it goes back to the same
        #: platform as the same user, rather than re-resolving and possibly
        #: finding a different one — or nothing at all.
        self.__context__: Any = None

    # ---- query entry points --------------------------------------------------
    #
    # The class itself is the root object set, so `People.take(10)` reads as one
    # thought. Each of these is one line onto `ObjectSet`, which is imported
    # inside the body: `query` needs these classes for typing, and importing it
    # at module level would close the cycle.

    @classmethod
    def objects(cls: type[S]) -> ObjectSet[S]:
        """The unfiltered set — the root every other call refines."""
        from .query import ObjectSet

        return ObjectSet(cls)

    @classmethod
    def where(cls: type[S], *filters: Filter) -> ObjectSet[S]:
        return cls.objects().where(*filters)

    @classmethod
    def order_by(cls: type[S], *sorts: Sort) -> ObjectSet[S]:
        return cls.objects().order_by(*sorts)

    @classmethod
    def select(cls: type[S], *properties: PropertyRef[Any] | str) -> ObjectSet[S]:
        return cls.objects().select(*properties)

    @classmethod
    def with_context(cls: type[S], context: Context) -> ObjectSet[S]:
        return cls.objects().with_context(context)

    @classmethod
    def take(cls: type[S], limit: int = 50) -> list[S]:
        return cls.objects().take(limit)

    @classmethod
    def iterate(cls: type[S], page_size: int = 500) -> Iterator[S]:
        return cls.objects().iterate(page_size)

    @classmethod
    def count(cls: type[S]) -> int:
        return cls.objects().count()

    @classmethod
    def get(cls: type[S], *values: Any, **named: Any) -> S | None:
        return cls.objects().get(*values, **named)

    @classmethod
    def raw(cls: type[S], arguments: dict[str, Any]) -> Page[S]:
        return cls.objects().raw(arguments)

    @classmethod
    def __properties__(cls) -> tuple[Property[Any], ...]:
        """Declared properties, in declaration order."""
        return tuple(
            value
            for klass in reversed(cls.__mro__)
            for value in vars(klass).values()
            if isinstance(value, Property)
        )

    def __value_of__(self, prop: Property[Any]) -> Any:
        """Decode one property, once.

        A property that is absent raises rather than reading as `None`: it means
        either that the query did not select it or that the schema moved, and
        both are worth knowing at the call site.
        """
        if prop.bkn_id in self.__cache__:
            return self.__cache__[prop.bkn_id]
        if prop.bkn_id not in self.__data__:
            raise SchemaDriftError(
                f"'{type(self).__name__}.{prop.attribute}' was not returned for this instance. "
                "Either the query selected a subset of properties, or the generated package is "
                "out of date — check with `bkn-osdk check`."
            )
        value = decode(self.__data__[prop.bkn_id], prop.python_type)
        self.__cache__[prop.bkn_id] = value
        return value

    def __repr__(self) -> str:
        label = self.__instance_id__ or self.__identity__ or ""
        return f"{type(self).__name__}({label!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ObjectType):
            return NotImplemented
        return (type(self), self.__identity__) == (type(other), other.__identity__)

    def __hash__(self) -> int:
        return hash((type(self).__name__, tuple(sorted(self.__identity__.items()))))


def decode(value: Any, python_type: type[Any] | None) -> Any:
    """Wire value to Python value, driven by the declared type.

    Two conversions carry real information:

    - a `decimal` arrives as a JSON string (`"14485.37"`), so `Decimal(str)` is
      both correct and lossless where `float` would already have rounded;
    - a `datetime` arrives ISO 8601 with an offset
      (`2026-07-07T21:14:17.891674+08:00`), which `fromisoformat` reads.

    Anything else passes through: the platform's JSON types already match.
    """
    if value is None or python_type is None:
        return value
    if python_type is Decimal and isinstance(value, str | int | float):
        return Decimal(str(value))
    if isinstance(value, str):
        if python_type is datetime:
            return datetime.fromisoformat(value)
        if python_type is date:
            return date.fromisoformat(value)
        if python_type is time:
            return time.fromisoformat(value)
    return value
