"""
Simple Assignment Database Module
Handles persistent storage of format part to RFID tag assignments.
Uses SQLite for local, container-friendly storage.
"""

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

try:
    from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean
    from sqlalchemy.ext.declarative import declarative_base
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    import aiosqlite
    SQLALCHEMY_AVAILABLE = True
except ImportError:
    SQLALCHEMY_AVAILABLE = False
    logging.warning("SQLAlchemy not available. Database features will be disabled.")

logger = logging.getLogger(__name__)

Base = declarative_base()

class FormatPartAssignment(Base):
    """Model for format part to RFID tag assignments"""
    __tablename__ = 'format_part_assignments'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    format_part = Column(String(100), nullable=False, unique=True)  # z.B. "1A1", "2B3"
    rfid_tag_id = Column(String(100), nullable=False)  # z.B. "RFID-001"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, default=True)

class RFIDTag(Base):
    """Model for RFID tags observed via OPC UA (deduplicated with metadata)."""
    __tablename__ = 'rfid_tags'

    id = Column(Integer, primary_key=True, autoincrement=True)
    tag_id = Column(String(100), nullable=False, unique=True)
    first_seen = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_seen = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    read_count = Column(Integer, default=1)

class SimpleAssignmentManager:
    """Manages simple format part to RFID tag assignments"""
    
    def __init__(self, db_path: str = "assignments.db"):
        self.db_path = Path(db_path)
        self.engine = None
        self.async_session = None
        self.initialized = False
    
    async def initialize(self):
        """Initialize the database connection and create tables"""
        if not SQLALCHEMY_AVAILABLE:
            logger.error("SQLAlchemy not available, cannot initialize database")
            return False
        
        try:
            # Ensure directory exists
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Create async engine for SQLite
            database_url = f"sqlite+aiosqlite:///{self.db_path}"
            self.engine = create_async_engine(database_url, echo=False)
            
            # Create async session factory
            self.async_session = async_sessionmaker(
                bind=self.engine, 
                class_=AsyncSession, 
                expire_on_commit=False
            )
            
            # Create tables
            async with self.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            
            self.initialized = True
            logger.info(f"Simple assignment database initialized at {self.db_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize assignment database: {e}")
            return False
    
    async def ensure_initialized(self):
        """Ensure database is initialized"""
        if not self.initialized:
            await self.initialize()
        return self.initialized
    
    async def assign_rfid_to_part(self, format_part: str, rfid_tag_id: str) -> bool:
        """Assign an RFID tag to a format part"""
        if not await self.ensure_initialized():
            return False
        
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                
                # Check if assignment already exists
                result = await session.execute(
                    select(FormatPartAssignment).where(
                        FormatPartAssignment.format_part == format_part
                    )
                )
                existing = result.scalar_one_or_none()
                
                if existing:
                    # Update existing assignment
                    existing.rfid_tag_id = rfid_tag_id
                    existing.updated_at = datetime.now(timezone.utc)
                    existing.is_active = True
                else:
                    # Create new assignment
                    new_assignment = FormatPartAssignment(
                        format_part=format_part,
                        rfid_tag_id=rfid_tag_id
                    )
                    session.add(new_assignment)
                
                await session.commit()
                logger.info(f"Assigned {rfid_tag_id} to format part {format_part}")
                return True
                
        except Exception as e:
            logger.error(f"Error assigning RFID {rfid_tag_id} to part {format_part}: {e}")
            return False
    
    async def unassign_rfid_from_part(self, format_part: str) -> bool:
        """Remove RFID assignment from a format part"""
        if not await self.ensure_initialized():
            return False
        
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                
                result = await session.execute(
                    select(FormatPartAssignment).where(
                        FormatPartAssignment.format_part == format_part
                    )
                )
                assignment = result.scalar_one_or_none()
                
                if assignment:
                    assignment.is_active = False
                    assignment.updated_at = datetime.now(timezone.utc)
                    await session.commit()
                    logger.info(f"Unassigned RFID from format part {format_part}")
                    return True
                
                return False
                
        except Exception as e:
            logger.error(f"Error unassigning RFID from part {format_part}: {e}")
            return False
    
    async def get_all_assignments(self) -> Dict[str, str]:
        """Get all active assignments as dict {format_part: rfid_tag_id}"""
        if not await self.ensure_initialized():
            return {}
        
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                
                result = await session.execute(
                    select(FormatPartAssignment).where(
                        FormatPartAssignment.is_active == True
                    )
                )
                assignments = result.scalars().all()
                
                return {
                    assignment.format_part: assignment.rfid_tag_id 
                    for assignment in assignments
                }
                
        except Exception as e:
            logger.error(f"Error getting assignments: {e}")
            return {}
    
    async def get_assignment_for_part(self, format_part: str) -> Optional[str]:
        """Get RFID tag assigned to a specific format part"""
        if not await self.ensure_initialized():
            return None
        
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                
                result = await session.execute(
                    select(FormatPartAssignment).where(
                        FormatPartAssignment.format_part == format_part,
                        FormatPartAssignment.is_active == True
                    )
                )
                assignment = result.scalar_one_or_none()
                
                return assignment.rfid_tag_id if assignment else None
                
        except Exception as e:
            logger.error(f"Error getting assignment for part {format_part}: {e}")
            return None
    
    async def get_part_for_rfid(self, rfid_tag_id: str) -> Optional[str]:
        """Get format part assigned to a specific RFID tag"""
        if not await self.ensure_initialized():
            return None
        
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                
                result = await session.execute(
                    select(FormatPartAssignment).where(
                        FormatPartAssignment.rfid_tag_id == rfid_tag_id,
                        FormatPartAssignment.is_active == True
                    )
                )
                assignment = result.scalar_one_or_none()
                
                return assignment.format_part if assignment else None
                
        except Exception as e:
            logger.error(f"Error getting part for RFID {rfid_tag_id}: {e}")
            return None
    
    async def get_assignments_list(self) -> List[Dict[str, Any]]:
        """Get all assignments as a list of dictionaries"""
        if not await self.ensure_initialized():
            return []
        
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                
                result = await session.execute(
                    select(FormatPartAssignment).where(
                        FormatPartAssignment.is_active == True
                    ).order_by(FormatPartAssignment.created_at)
                )
                assignments = result.scalars().all()
                
                return [
                    {
                        "id": assignment.id,
                        "format_part": assignment.format_part,
                        "rfid_tag_id": assignment.rfid_tag_id,
                        "created_at": assignment.created_at.isoformat(),
                        "updated_at": assignment.updated_at.isoformat()
                    }
                    for assignment in assignments
                ]
                
        except Exception as e:
            logger.error(f"Error getting assignments list: {e}")
            return []

    # ---------------- RFID Tag Persistence -----------------
    async def record_rfid_tag(self, tag_id: str) -> bool:
        """Insert or update an RFID tag observation.

        Increases read_count and updates last_seen when tag already exists.
        """
        if not await self.ensure_initialized():
            return False
        if not tag_id:
            return False
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                from sqlalchemy.exc import IntegrityError

                result = await session.execute(select(RFIDTag).where(RFIDTag.tag_id == tag_id))
                tag = result.scalar_one_or_none()
                if tag:
                    tag.read_count += 1
                    tag.last_seen = datetime.now(timezone.utc)
                else:
                    session.add(RFIDTag(tag_id=tag_id))
                await session.commit()
                return True
        except IntegrityError:
            logger.warning("Race condition inserting RFID tag, ignoring.")
            return True
        except Exception as e:
            logger.error(f"Error recording RFID tag {tag_id}: {e}")
            return False

    async def list_rfid_tags(self) -> List[Dict[str, Any]]:
        """Return all known RFID tags with metadata."""
        if not await self.ensure_initialized():
            return []
        try:
            async with self.async_session() as session:
                from sqlalchemy import select
                result = await session.execute(select(RFIDTag).order_by(RFIDTag.last_seen.desc()))
                rows = result.scalars().all()
                return [
                    {
                        "tag_id": r.tag_id,
                        "first_seen": r.first_seen.isoformat(),
                        "last_seen": r.last_seen.isoformat(),
                        "read_count": r.read_count
                    } for r in rows
                ]
        except Exception as e:
            logger.error(f"Error listing RFID tags: {e}")
            return []

    async def get_rfid_tag_ids(self) -> List[str]:
        """Return only the tag_id strings."""
        tags = await self.list_rfid_tags()
        return [t["tag_id"] for t in tags]
    
    async def close(self):
        """Close database connections"""
        if self.engine:
            await self.engine.dispose()
            logger.info("Simple assignment database connections closed")
